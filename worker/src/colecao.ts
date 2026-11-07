/**
 * Coleção interna (#80): sets que acompanhamos e quantas de cada variante temos. Uma coleção só, compartilhada pelos
 * e-mails de OWNER_EMAILS. Quem não está na lista (ou não entrou) recebe o mesmo 404 de uma rota que não existe.
 * Nome, número, imagem e variantes da carta vêm de tcg_cards/tcg_sets (/api/tcg/*); aqui só a posse.
 */
import { setOfCard } from '../../src/domain/colecao';
import { OrderError } from '../../src/domain/order';
import { currentUser, isOwner } from './account-routes';
import type { User } from './accounts';
import type { Env } from './env';
import { handleError, json, readJson } from './http';
import { parseStoredDef } from './notion';

const ID = /^[\w.!%-]{1,80}$/;
const MAX_QTY = 999;
const notFound = () => json({ error: 'Não encontrado' }, 404);

const state = async (db: NonNullable<Env['DB']>) => {
  const sets = (await db.prepare('SELECT set_id FROM col_sets ORDER BY added_at, set_id').all<{ set_id: string }>())
    .results;
  const items = (
    await db
      .prepare('SELECT card_id, variant, qty FROM col_items')
      .all<{ card_id: string; variant: string; qty: number }>()
  ).results;
  return { sets: sets.map((s) => s.set_id), items: items.map((i) => [i.card_id, i.variant, i.qty]) };
};

/** PUT /api/colecao/sets/:id — `{ track: boolean }` começa ou para de acompanhar um set da enciclopédia. */
const trackSet = async (db: NonNullable<Env['DB']>, setId: string, body: Record<string, unknown>) => {
  if (typeof body.track !== 'boolean') throw new OrderError(400, 'Pedido inválido');
  if (body.track) {
    if (!(await db.prepare('SELECT id FROM tcg_sets WHERE id = ?').bind(setId).first())) return notFound();
    await db
      .prepare('INSERT INTO col_sets (set_id, added_at) VALUES (?, ?) ON CONFLICT(set_id) DO NOTHING')
      .bind(setId, new Date().toISOString())
      .run();
  } else await db.prepare('DELETE FROM col_sets WHERE set_id = ?').bind(setId).run();
  return json({ set: setId, track: body.track });
};

/** PUT /api/colecao/item — `{ cardId, variant, qty }` grava só essa linha; qty 0 = não temos. */
const setItem = async (db: NonNullable<Env['DB']>, user: User, body: Record<string, unknown>) => {
  const { cardId, variant, qty } = body;
  if (typeof cardId !== 'string' || !ID.test(cardId) || typeof variant !== 'string')
    throw new OrderError(400, 'Pedido inválido');
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0 || qty > MAX_QTY)
    throw new OrderError(400, 'Quantidade inválida');
  const card = await db
    .prepare('SELECT variants FROM tcg_cards WHERE id = ?')
    .bind(cardId)
    .first<{ variants: string | null }>();
  if (!card) return notFound();
  // Carta sem variantes informadas pelo TCGdex vale como uma só: normal.
  if (!(card.variants ?? 'normal').split(',').includes(variant)) throw new OrderError(400, 'Variante inválida');
  if (qty === 0)
    await db.prepare('DELETE FROM col_items WHERE card_id = ? AND variant = ?').bind(cardId, variant).run();
  else
    await db
      .prepare(
        `INSERT INTO col_items (card_id, variant, qty, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(card_id, variant) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(cardId, variant, qty, new Date().toISOString(), user.email)
      .run();
  return json({ cardId, variant, qty });
};

const MAX_BULK = 2000;

/**
 * PUT /api/colecao/sets/:id/marcar — `{ on, items: [cartaId, variante][] }`: marca (qtd mínima 1, sem baixar quem já tem
 * mais) ou desmarca de uma vez. Uma instrução só no D1 (o JSON vai num único parâmetro): o plano gratuito limita
 * escritas e consultas por chamada, e um lote de centenas de cartas não pode virar centenas de pedidos.
 * Só vale carta do próprio set e variante que ela tem; o resto é ignorado.
 */
const markSet = async (db: NonNullable<Env['DB']>, user: User, setId: string, body: Record<string, unknown>) => {
  if (typeof body.on !== 'boolean' || !Array.isArray(body.items) || body.items.length > MAX_BULK)
    throw new OrderError(400, 'Pedido inválido');
  const cards = (
    await db
      .prepare('SELECT id, variants FROM tcg_cards WHERE set_id = ?')
      .bind(setId)
      .all<{ id: string; variants: string | null }>()
  ).results;
  if (!cards.length) return notFound();
  const allowed = new Map(cards.map((c) => [c.id, (c.variants ?? 'normal').split(',')]));
  const rows = [
    ...new Map(
      body.items.flatMap((row): [string, [string, string]][] =>
        Array.isArray(row) &&
        typeof row[0] === 'string' &&
        typeof row[1] === 'string' &&
        allowed.get(row[0])?.includes(row[1])
          ? [[`${row[0]}|${row[1]}`, [row[0], row[1]]]]
          : [],
      ),
    ).values(),
  ];
  if (rows.length) {
    const pairs = JSON.stringify(rows);
    if (body.on)
      await db
        .prepare(
          `INSERT INTO col_items (card_id, variant, qty, updated_at, updated_by)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), 1, ?, ? FROM json_each(?) WHERE true
           ON CONFLICT(card_id, variant) DO UPDATE SET qty = MAX(qty, 1), updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(new Date().toISOString(), user.email, pairs)
        .run();
    else
      await db
        .prepare(
          `DELETE FROM col_items WHERE (card_id, variant) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))`,
        )
        .bind(pairs)
        .run();
  }
  return json({ on: body.on, count: rows.length });
};

/**
 * GET /api/colecao/estoque?set=<id> — cartas do set à venda no Notion (já espelhado no D1): só as ativas e com estoque.
 * Não chama o Notion; o cron de 10 minutos mantém `products` em dia. O `/api/catalog` é público, esta rota não.
 */
const stockOfSet = async (db: NonNullable<Env['DB']>, setId: string) => {
  const rows = (
    await db
      .prepare(
        'SELECT id, price, qty, def FROM products WHERE active = 1 AND (qty IS NULL OR qty > 0) AND def IS NOT NULL',
      )
      .all<{ id: string; price: number | null; qty: number | null; def: string }>()
  ).results;
  const stock = rows.flatMap((r) => {
    let def: ReturnType<typeof parseStoredDef> = null;
    try {
      def = parseStoredDef(JSON.parse(r.def));
    } catch {
      // def estragado: a linha fica de fora
    }
    return def?.kind === 'item' && setOfCard(def.tcgdex) === setId
      ? [
          {
            id: r.id,
            cardId: def.tcgdex,
            lang: def.lang,
            variant: def.variant,
            grade: def.grade ? `${def.grade.co} ${def.grade.n}` : '',
            price: r.price,
            available: r.qty,
          },
        ]
      : [];
  });
  return json({ stock });
};

/**
 * PUT /api/colecao/estoque/:id — `{ delta: -1 | 1 }` ajusta as unidades de uma carta à venda. Por diferença, não por valor
 * absoluto: uma venda que baixa o estoque ao mesmo tempo não é sobrescrita (mesma atualização atômica do `takeStock`).
 * Fica pendente (`dirty`) e o cron de 10 minutos grava no Notion. Produto sem controle de estoque não muda.
 */
const adjustStock = async (db: NonNullable<Env['DB']>, id: string, body: Record<string, unknown>) => {
  const { delta } = body;
  if (delta !== 1 && delta !== -1) throw new OrderError(400, 'Pedido inválido');
  const row = await db
    .prepare(
      'UPDATE products SET qty = qty + ?, dirty = 1 WHERE id = ? AND active = 1 AND def IS NOT NULL AND qty IS NOT NULL AND qty + ? BETWEEN 0 AND ? RETURNING qty',
    )
    .bind(delta, id, delta, MAX_QTY)
    .first<{ qty: number }>();
  if (row) return json({ id, available: row.qty });
  const now = await db
    .prepare('SELECT qty FROM products WHERE id = ? AND active = 1 AND def IS NOT NULL')
    .bind(id)
    .first<{ qty: number | null }>();
  if (now?.qty == null) return notFound();
  throw new OrderError(409, delta < 0 ? 'Não há mais unidades no estoque.' : 'Estoque no limite.');
};

/** GET/PUT /api/colecao… Devolve null se o caminho não é da coleção. */
export const colecaoRoutes = async (request: Request, env: Env, path: string): Promise<Response | null> => {
  if (path !== '/api/colecao' && !path.startsWith('/api/colecao/')) return null;
  const user = await currentUser(request, env);
  if (!env.DB || !isOwner(env, user) || !user) return notFound();
  const db = env.DB;
  const { method } = request;
  try {
    if (path === '/api/colecao' && method === 'GET') return json(await state(db));
    if (path === '/api/colecao/estoque' && method === 'GET') {
      const set = new URL(request.url).searchParams.get('set') ?? '';
      if (!ID.test(set)) throw new OrderError(400, 'Set inválido');
      return await stockOfSet(db, set);
    }
    const stockId = path.match(/^\/api\/colecao\/estoque\/([\w.!%-]{1,80})$/);
    if (stockId?.[1] && method === 'PUT') return await adjustStock(db, stockId[1], await readJson(request));
    const set = path.match(/^\/api\/colecao\/sets\/([\w.!%-]{1,80})$/);
    if (set?.[1] && method === 'PUT') return await trackSet(db, set[1], await readJson(request));
    const mark = path.match(/^\/api\/colecao\/sets\/([\w.!%-]{1,80})\/marcar$/);
    if (mark?.[1] && method === 'PUT') return await markSet(db, user, mark[1], await readJson(request));
    if (path === '/api/colecao/item' && method === 'PUT') return await setItem(db, user, await readJson(request));
  } catch (e) {
    return handleError(e, 'coleção');
  }
  return notFound();
};
