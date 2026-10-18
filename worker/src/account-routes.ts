/** Rotas de conta (#29): Entrar com Google (#43), sessão, dados da conta, Dex e LGPD (exportar e apagar). */
import { parseDex } from '../../src/domain/collection';
import { OrderError } from '../../src/domain/order';
import { isEmail } from '../../src/domain/validation';
import {
  deleteAccount,
  endSession,
  exportAccount,
  getAccount,
  pendingCustody,
  SESSION_TTL,
  saveDex,
  sessionUser,
  startSession,
  type User,
} from './accounts';
import type { Env } from './env';
import { handleError, json, limited, log, notice, readCookie, readJson, SESSION_COOKIE, sessionCookie } from './http';

/** Usuário da sessão do cookie; null sem sessão (ou sem banco). */
export const currentUser = async (request: Request, env: Env): Promise<User | null> => {
  const token = readCookie(request, SESSION_COOKIE);
  return env.DB && token && /^[0-9a-f]{64}$/.test(token) ? sessionUser(env.DB, token) : null;
};

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const OAUTH_COOKIE = 'cbx_oauth';
const oauthCookie = (value: string, maxAge: number) =>
  `${OAUTH_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=${maxAge}`;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
/** Volta para este mesmo endereço (domínio, www ou localhost): o cookie do state só existe nele. */
const callbackUrl = (request: Request) => `${new URL(request.url).origin}/api/auth/google/callback`;

/** GET /api/auth/google — manda para o Google com state (contra CSRF) e PKCE, guardados num cookie de 10 min. */
const googleStart = async (request: Request, env: Env) => {
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return notice('O login ainda não está disponível. Tente mais tarde.', 503);
  const blocked = await limited(request, env.QUOTES_LIMITER);
  if (blocked) return blocked;
  const state = random();
  const verifier = random();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const to = new URL(GOOGLE_AUTH);
  to.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(request),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(to.toString(), [oauthCookie(`${state}.${verifier}`, 600)]);
};

/** Dados do id_token. Veio direto do Google por HTTPS, autenticado com o segredo: dispensa conferir a assinatura. */
const idClaims = (idToken: string) => {
  const part = (idToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0)))) as Record<
    string,
    unknown
  >;
};

/** GET /api/auth/google/callback — confere o state, troca o código e abre a sessão pelo e-mail confirmado. */
const googleCallback = async (request: Request, env: Env, f: typeof fetch) => {
  const url = new URL(request.url);
  const fail = (why: string) => {
    log('warn', 'login com Google recusado', { motivo: why });
    return redirect('/#/conta/erro-login', [oauthCookie('', 0)]);
  };
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('desligado');
  const [state, verifier] = (readCookie(request, OAUTH_COOKIE) ?? '').split('.');
  const code = url.searchParams.get('code');
  if (!state || !verifier || url.searchParams.get('state') !== state) return fail('state');
  if (!code) return fail(url.searchParams.get('error') ?? 'sem código');
  try {
    const res = await f(GOOGLE_TOKEN, {
      method: 'POST',
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl(request),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fail(`token ${res.status}`);
    const claims = idClaims(String(((await res.json()) as { id_token?: string }).id_token ?? ''));
    const email = String(claims.email ?? '').toLowerCase();
    const issuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (claims.aud !== env.GOOGLE_CLIENT_ID || !issuer || claims.email_verified !== true || !isEmail(email))
      return fail('id_token');
    const session = await startSession(env.DB, email, String(claims.given_name ?? claims.name ?? '').slice(0, 80));
    if (!session) return fail('sessão');
    return redirect('/#/conta', [oauthCookie('', 0), sessionCookie(session, SESSION_TTL / 1000)]);
  } catch (e) {
    return fail(String(e).slice(0, 80));
  }
};

const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: to });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers });
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

export const accountRoutes = async (
  request: Request,
  env: Env,
  path: string,
  f: typeof fetch,
): Promise<Response | null> => {
  const { method } = request;
  try {
    if (path === '/api/auth/google' && method === 'GET') return await googleStart(request, env);
    if (path === '/api/auth/google/callback' && method === 'GET') return await googleCallback(request, env, f);
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
