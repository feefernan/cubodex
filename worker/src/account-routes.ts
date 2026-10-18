/** Rotas de conta (#29): login por link mágico, sessão, dados da conta, Dex e LGPD (exportar e apagar). */
import { parseDex } from '../../src/domain/collection';
import { OrderError } from '../../src/domain/order';
import { isEmail } from '../../src/domain/validation';
import {
  createLoginToken,
  deleteAccount,
  endSession,
  exportAccount,
  getAccount,
  pendingCustody,
  redeemLoginToken,
  SESSION_TTL,
  saveDex,
  sessionUser,
  type User,
} from './accounts';
import { sendLoginEmail } from './email';
import type { Env } from './env';
import {
  handleError,
  json,
  limited,
  log,
  notice,
  page,
  readCookie,
  readJson,
  SESSION_COOKIE,
  sessionCookie,
  unavailable,
} from './http';

/** Usuário da sessão do cookie; null sem sessão (ou sem banco). */
export const currentUser = async (request: Request, env: Env): Promise<User | null> => {
  const token = readCookie(request, SESSION_COOKIE);
  return env.DB && token && /^[0-9a-f]{64}$/.test(token) ? sessionUser(env.DB, token) : null;
};

/** Desenvolvimento na própria máquina (cf dev / vite): o link de login vai para o log, sem e-mail. */
const isLocal = (request: Request) => ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);

/** POST /api/auth/request — { email } → manda o link de entrada. Mesma resposta exista a conta ou não. */
const requestLogin = async (request: Request, env: Env) => {
  const blocked = await limited(request, env.QUOTES_LIMITER);
  if (blocked) return blocked;
  const mailOn = !!env.EMAIL && !!env.EMAIL_FROM;
  if (!env.DB || (!mailOn && !isLocal(request))) return unavailable();
  try {
    const input = await readJson(request);
    const email = String(input.email ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 200);
    if (!isEmail(email)) throw new OrderError(400, 'Digite um e-mail válido.');
    // Um e-mail não recebe uma enxurrada de links, mesmo vindo de IPs diferentes.
    // Limite próprio e apertado (#39): com IPs trocados, ninguém inunda a caixa de alguém com links.
    const perEmail = await limited(request, env.LOGIN_LIMITER, `login:${email}`);
    if (perEmail) return perEmail;
    const token = await createLoginToken(env.DB, email);
    const origin = isLocal(request) ? new URL(request.url).origin : env.SITE_URL;
    const link = `${origin}/api/auth/verify?t=${token}`;
    if (mailOn && env.EMAIL) await sendLoginEmail(env.EMAIL, env.EMAIL_FROM, email, link);
    // Desenvolvimento local sem domínio de e-mail: o link aparece no log do Worker.
    else log('info', 'link de login (só em localhost)', { link });
    return json({ ok: true });
  } catch (e) {
    return handleError(e, 'envio do link de login');
  }
};

/**
 * GET /api/auth/verify?t= — página com um botão. Verificadores de link dos e-mails abrem a URL sozinhos;
 * se o GET já entrasse, gastariam o token antes da pessoa. Só o POST (clique) troca o token pela sessão.
 */
const verifyPage = (url: URL) => {
  const token = url.searchParams.get('t') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return notice('Link inválido. Peça um novo na página da conta.', 400);
  return page(
    `<h1 style="font-size:24px">entrar na cubodex</h1><form method="post" action="/api/auth/verify"><input type="hidden" name="t" value="${token}"><button style="font:700 16px system-ui;padding:12px 20px;border:0;border-radius:8px;background:#D21F3C;color:#fff;cursor:pointer">entrar</button></form>`,
  );
};

const redirect = (to: string, cookie?: string) =>
  new Response(null, { status: 303, headers: { Location: to, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

/** POST /api/auth/verify — troca o token pela sessão (cookie) e volta para a conta. */
const verify = async (request: Request, env: Env) => {
  // Formulário do próprio site: a origem tem que ser a deste endereço (barra login forçado por outro site).
  if (request.headers.get('Origin') !== new URL(request.url).origin) return notice('Origem inválida.', 403);
  if (!env.DB) return notice('Login indisponível no momento.', 503);
  const token = String((await request.formData().catch(() => null))?.get('t') ?? '');
  if (!/^[0-9a-f]{64}$/.test(token)) return redirect('/#/conta/link-expirado');
  const session = await redeemLoginToken(env.DB, token);
  return session
    ? redirect('/#/conta', sessionCookie(session, SESSION_TTL / 1000))
    : redirect('/#/conta/link-expirado');
};

const clearCookie = { 'Set-Cookie': sessionCookie('', 0) };

/** POST /api/auth/logout — encerra a sessão deste aparelho. */
const logout = async (request: Request, env: Env) => {
  try {
    await readJson(request);
    const token = readCookie(request, SESSION_COOKIE);
    if (env.DB && token) await endSession(env.DB, token);
    return json({ ok: true }, 200, clearCookie);
  } catch (e) {
    return handleError(e, 'saída da conta');
  }
};

const withUser = async (
  request: Request,
  env: Env,
  run: (user: User, db: NonNullable<Env['DB']>) => Promise<Response>,
) => {
  const user = await currentUser(request, env);
  if (!user || !env.DB) return json({ error: 'Entre na sua conta.' }, 401);
  return run(user, env.DB);
};

export const accountRoutes = async (request: Request, env: Env, path: string): Promise<Response | null> => {
  const { method } = request;
  try {
    if (path === '/api/auth/request' && method === 'POST') return await requestLogin(request, env);
    if (path === '/api/auth/verify' && method === 'GET') return verifyPage(new URL(request.url));
    if (path === '/api/auth/verify' && method === 'POST') return await verify(request, env);
    if (path === '/api/auth/logout' && method === 'POST') return await logout(request, env);
    if (path === '/api/me' && method === 'GET')
      return await withUser(request, env, async (u, db) => json(await getAccount(db, u)));
    if (path === '/api/me/export' && method === 'GET')
      return await withUser(request, env, async (u, db) =>
        json(await exportAccount(db, u), 200, {
          'Content-Disposition': 'attachment; filename="minha-conta-cubodex.json"',
        }),
      );
    if (path === '/api/me' && method === 'DELETE')
      return await withUser(request, env, async (u, db) => {
        await readJson(request);
        // Cartas guardadas (ou pagas para o cofre e ainda não confirmadas) são bens do cliente.
        if (await pendingCustody(db, u.id))
          throw new OrderError(
            409,
            'Você ainda tem itens no cofre ou uma compra para o cofre em andamento. Peça o envio antes de apagar a conta.',
          );
        await deleteAccount(db, u.id);
        log('info', 'conta apagada a pedido do titular', {});
        return json({ ok: true }, 200, clearCookie);
      });
    if (path === '/api/dex' && method === 'PUT')
      return await withUser(request, env, async (u, db) => {
        const dex = parseDex((await readJson(request)).dex);
        await saveDex(db, u.id, dex);
        return json({ dex });
      });
  } catch (e) {
    return handleError(e, 'conta');
  }
  return null;
};
