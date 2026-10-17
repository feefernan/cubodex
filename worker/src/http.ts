/** Utilitários HTTP da API: JSON, limites, leitura segura do corpo, erros e cookie de sessão. */
import { OrderError } from '../../src/domain/order';
import type { Limiter } from './env';

const MAX_BODY_BYTES = 64 * 1024;

export const log = (level: 'info' | 'warn' | 'error', msg: string, data: Record<string, unknown> = {}) =>
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, msg, ...data }));

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

export const unavailable = () => json({ error: 'Isso ainda não está disponível. Tente mais tarde.' }, 503);

/** Limite por IP; null = pode seguir. */
export const limited = async (
  request: Request,
  limiter: Limiter,
  key = request.headers.get('CF-Connecting-IP') ?? 'local',
) => {
  return (await limiter.limit({ key })).success
    ? null
    : json({ error: 'Muitos pedidos seguidos, tente em 1 minuto' }, 429);
};

/**
 * Lê o corpo JSON. Exigir Content-Type JSON barra formulários de outros sites (CSRF): um navegador só manda
 * esse tipo de outra origem com CORS, que esta API não libera.
 */
export const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new OrderError(415, 'Envie JSON');
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) throw new OrderError(413, 'Pedido grande demais');
  try {
    const data = JSON.parse(new TextDecoder().decode(raw));
    if (data && typeof data === 'object') return data;
  } catch {
    /* cai no erro abaixo */
  }
  throw new OrderError(400, 'Pedido inválido');
};

export const handleError = (e: unknown, what: string) => {
  if (e instanceof OrderError) return json({ error: e.message }, e.status);
  log('error', `${what} falhou`, { error: String(e) });
  return json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.' }, 502);
};

/** Página HTML mínima para links abertos do e-mail (saída da lista, login). `body` é HTML já seguro. */
export const page = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cubodex</title><body style="font:16px system-ui;padding:40px;max-width:40ch;margin:auto">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } },
  );

export const SESSION_COOKIE = 'cbx_sess';

export const readCookie = (request: Request, name: string) =>
  (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1] ?? null;

/** Cookie de sessão: só o servidor lê (HttpOnly), só via HTTPS, e não vai em pedidos de outros sites. */
export const sessionCookie = (token: string, maxAgeSeconds: number) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;

/** Página com uma mensagem e o link de volta para a loja. */
export const notice = (msg: string, status = 200) =>
  page(`<p>${msg}</p><p><a href="/">voltar para a cubodex</a></p>`, status);
