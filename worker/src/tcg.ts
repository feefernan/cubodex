/**
 * API da enciclopédia TCG (Fase 3.2), lendo as tabelas que a Action semanal enche. Os dados só mudam uma vez por
 * semana: toda resposta vai para a Cache API da borda e para o navegador, então quase nenhum pedido chega ao D1
 * (o plano gratuito tem 5 milhões de linhas lidas por dia, e uma busca por trecho no banco leria as 24 mil).
 */
import type { Ctx, Env } from './env';
import { json, limited } from './http';

const CARD_ID = /^[\w.!%-]{1,80}$/;

/** Responde da Cache API quando há; senão monta, guarda (sem atrapalhar a resposta) e devolve. */
const cached = async (request: Request, ctx: Ctx, maxAge: number, build: () => Promise<Response>) => {
  const cache = typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default;
  const hit = await cache?.match(request);
  if (hit) return hit;
  const res = await build();
  if (res.status === 200 && cache) {
    const stored = new Response(res.clone().body, res);
    stored.headers.set('Cache-Control', `public, max-age=${maxAge}`);
    ctx.waitUntil(cache.put(request, stored));
  }
  return res;
};

const ok = (body: unknown, maxAge: number) => json(body, 200, { 'Cache-Control': `public, max-age=${maxAge}` });

const SET_COLS = 'id, name, name_pt, serie_id, serie, released, total, official, logo';
const CARD_COLS = 'id, local_id, num, name, name_pt, rarity, types, variants, image';

/** GET /api/tcg/sets · /sets/:id · /cards/:id · /index. Devolve null se o caminho não é da enciclopédia. */
export const tcgRoutes = async (request: Request, env: Env, path: string, ctx: Ctx): Promise<Response | null> => {
  if (!path.startsWith('/api/tcg/') || request.method !== 'GET') return null;
  const db = env.DB;
  if (!db) return json({ error: 'A enciclopédia ainda não está disponível. Tente mais tarde.' }, 503);
  const [, , , kind, rawId] = path.split('/');
  let id = '';
  try {
    id = rawId ? decodeURIComponent(rawId) : '';
  } catch {
    return json({ error: 'Não encontrado' }, 404);
  }
  if (rawId && !CARD_ID.test(id)) return json({ error: 'Não encontrado' }, 404);

  const miss = async (maxAge: number, build: () => Promise<Response>) =>
    cached(request, ctx, maxAge, async () => (await limited(request, env.QUOTES_LIMITER)) ?? build());

  if (kind === 'sets' && !id)
    return miss(3600, async () =>
      ok(
        { sets: (await db.prepare(`SELECT ${SET_COLS} FROM tcg_sets ORDER BY released DESC, name`).all()).results },
        3600,
      ),
    );

  if (kind === 'sets')
    return miss(3600, async () => {
      const set = await db.prepare(`SELECT ${SET_COLS} FROM tcg_sets WHERE id = ?`).bind(id).first();
      if (!set) return json({ error: 'Set não encontrado' }, 404);
      const cards = (
        await db
          .prepare(`SELECT ${CARD_COLS} FROM tcg_cards WHERE set_id = ? ORDER BY num IS NULL, num, local_id`)
          .bind(id)
          .all()
      ).results;
      return ok({ set, cards }, 3600);
    });

  if (kind === 'cards' && id)
    return miss(3600, async () => {
      const card = await db
        .prepare(`SELECT ${CARD_COLS}, set_id FROM tcg_cards WHERE id = ?`)
        .bind(id)
        .first<{ set_id: string }>();
      if (!card) return json({ error: 'Carta não encontrada' }, 404);
      const set = await db.prepare(`SELECT ${SET_COLS} FROM tcg_sets WHERE id = ?`).bind(card.set_id).first();
      return ok({ card, set }, 3600);
    });

  // Nomes de todas as cartas, para o navegador buscar localmente (uma leitura do banco por dia por borda).
  if (kind === 'index' && !id)
    return miss(86_400, async () => {
      const rows = (
        await db.prepare('SELECT id, name, name_pt, set_id FROM tcg_cards').all<Record<string, string | null>>()
      ).results;
      return ok({ cards: rows.map((r) => [r.id, r.name, r.name_pt ?? '', r.set_id]) }, 86_400);
    });

  return json({ error: 'Não encontrado' }, 404);
};
