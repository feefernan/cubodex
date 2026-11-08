/**
 * Coleção interna (#80): quantas de cada variante da enciclopédia temos. Uma coleção só, compartilhada pelos
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

/**
 * GET /api/colecao — a coleção (`items`) e o estoque da loja de todos os sets (`shop`, só para o total "tenho" da landing e
 * das séries: coleção + estoque). `items` é só o que foi marcado.
 */
const state = async (db: NonNullable<Env['DB']>) => {
  const items = (
    await db
      .prepare('SELECT card_id, variant, qty FROM col_items')
      .all<{ card_id: string; variant: string; qty: number }>()
  ).results;
  return {
    items: items.map((i) => [i.card_id, i.variant, i.qty]),
    shop: (await stockRows(db)).map((r) => [r.cardId, r.variant || 'normal', r.available ?? 1]),
  };
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

/** As cartas à venda no Notion (já espelhado no D1): só as ativas e com estoque (ou sem controle de estoque). */
const stockRows = async (db: NonNullable<Env['DB']>) => {
  const rows = (
    await db
      .prepare(
        'SELECT id, price, qty, def FROM products WHERE active = 1 AND (qty IS NULL OR qty > 0) AND def IS NOT NULL',
      )
      .all<{ id: string; price: number | null; qty: number | null; def: string }>()
  ).results;
  return rows.flatMap((r) => {
    let def: ReturnType<typeof parseStoredDef> = null;
    try {
      def = parseStoredDef(JSON.parse(r.def));
    } catch {
      // def estragado: a linha fica de fora
    }
    return def?.kind === 'item'
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
};

/**
 * GET /api/colecao/estoque?set=<id> — as cartas do set à venda. Não chama o Notion; o cron de 10 minutos mantém
 * `products` em dia. O `/api/catalog` é público, esta rota não.
 */
const stockOfSet = async (db: NonNullable<Env['DB']>, setId: string) =>
  json({ stock: (await stockRows(db)).filter((r) => setOfCard(r.cardId) === setId) });

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
      'UPDATE products SET qty = qty + ?, dirty = 1 WHERE id = ? AND active = 1 AND def IS NOT NULL AND qty IS NOT NULL AND qty + ? >= 0 AND (? < 0 OR qty + ? <= ?) RETURNING qty',
    )
    .bind(delta, id, delta, delta, delta, MAX_QTY)
    .first<{ qty: number }>();
  if (row) return json({ id, available: row.qty });
  const now = await db
    .prepare('SELECT qty FROM products WHERE id = ? AND active = 1 AND def IS NOT NULL')
    .bind(id)
    .first<{ qty: number | null }>();
  if (now?.qty == null) return notFound();
  throw new OrderError(409, delta < 0 ? 'Não há mais unidades no estoque.' : 'Estoque no limite.');
};

const MAX_GIVE = 10;
const MAX_GET = 30;

const qtyOf = (v: unknown) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_QTY)
    throw new OrderError(400, 'Quantidade inválida');
  return v;
};

/**
 * POST /api/colecao/troca — `{ give: [{ id, qty }], get: [{ cardId, variant, qty }] }`: registra uma troca, que não precisa
 * ser 1:1. Baixa o estoque da loja do que sai e soma à coleção o que entra, tudo ou nada (um batch): se o estoque mudou
 * e já não cobre, nada é gravado (409). A baixa fica pendente (`dirty`) e o cron grava no Notion. Guarda uma foto da
 * troca em `col_trades`.
 */
const registerTrade = async (db: NonNullable<Env['DB']>, user: User, body: Record<string, unknown>) => {
  const { give, get } = body;
  if (
    !Array.isArray(give) ||
    !give.length ||
    give.length > MAX_GIVE ||
    !Array.isArray(get) ||
    !get.length ||
    get.length > MAX_GET
  )
    throw new OrderError(400, 'Pedido inválido');
  const out = new Map<string, number>();
  for (const g of give as Record<string, unknown>[]) {
    if (typeof g?.id !== 'string' || !ID.test(g.id)) throw new OrderError(400, 'Pedido inválido');
    out.set(g.id, (out.get(g.id) ?? 0) + qtyOf(g.qty));
  }
  const inn = new Map<string, { cardId: string; variant: string; qty: number }>();
  for (const g of get as Record<string, unknown>[]) {
    if (typeof g?.cardId !== 'string' || !ID.test(g.cardId) || typeof g.variant !== 'string')
      throw new OrderError(400, 'Pedido inválido');
    const key = `${g.cardId}|${g.variant}`;
    const prev = inn.get(key);
    inn.set(key, { cardId: g.cardId, variant: g.variant, qty: Math.min(MAX_QTY, (prev?.qty ?? 0) + qtyOf(g.qty)) });
  }
  // Duas consultas para qualquer tamanho de troca: o plano gratuito do D1 limita as consultas por chamada.
  const ids = JSON.stringify([...out.keys()]);
  const products = new Map(
    (
      await db
        .prepare(
          'SELECT id, price, qty, def FROM products WHERE active = 1 AND def IS NOT NULL AND id IN (SELECT value FROM json_each(?))',
        )
        .bind(ids)
        .all<{ id: string; price: number | null; qty: number | null; def: string }>()
    ).results.map((p) => [p.id, p]),
  );
  const gave = [];
  for (const [id, qty] of out) {
    const p = products.get(id);
    if (!p || p.qty === null) return notFound();
    gave.push({ id, qty, price: p.price, def: p.def });
  }
  const variants = new Map(
    (
      await db
        .prepare('SELECT id, variants FROM tcg_cards WHERE id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify([...new Set([...inn.values()].map((g) => g.cardId))]))
        .all<{ id: string; variants: string | null }>()
    ).results.map((c) => [c.id, c.variants]),
  );
  for (const { cardId, variant } of inn.values()) {
    if (!variants.has(cardId)) return notFound();
    // Carta sem variantes informadas pelo TCGdex vale como uma só: normal.
    if (!(variants.get(cardId) ?? 'normal').split(',').includes(variant))
      throw new OrderError(400, 'Variante inválida');
  }
  const now = new Date().toISOString();
  const outJson = JSON.stringify([...out].map(([id, qty]) => ({ id, qty })));
  try {
    await db.batch([
      // Falha de propósito (JSON inválido) se algum estoque já não cobre: o batch inteiro desfaz.
      db
        .prepare(
          `SELECT json(CASE WHEN EXISTS (SELECT 1 FROM json_each(?1) g LEFT JOIN products p ON p.id = json_extract(g.value, '$.id')
             WHERE p.id IS NULL OR p.active = 0 OR p.qty IS NULL OR p.qty < json_extract(g.value, '$.qty')) THEN 'x' ELSE '1' END)`,
        )
        .bind(outJson),
      db
        .prepare(
          `UPDATE products SET dirty = 1, qty = qty - (SELECT json_extract(g.value, '$.qty') FROM json_each(?1) g WHERE json_extract(g.value, '$.id') = products.id)
           WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
        )
        .bind(outJson),
      db
        .prepare(
          `INSERT INTO col_items (card_id, variant, qty, updated_at, updated_by)
           SELECT json_extract(value, '$.cardId'), json_extract(value, '$.variant'), json_extract(value, '$.qty'), ?2, ?3 FROM json_each(?1) WHERE true
           ON CONFLICT(card_id, variant) DO UPDATE SET qty = MIN(${MAX_QTY}, qty + excluded.qty), updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(JSON.stringify([...inn.values()]), now, user.email),
      db
        .prepare('INSERT INTO col_trades (at, by, gave, got) VALUES (?, ?, ?, ?)')
        .bind(now, user.email, JSON.stringify(gave), JSON.stringify([...inn.values()])),
    ]);
  } catch (e) {
    if (String(e).includes('malformed JSON'))
      throw new OrderError(409, 'O estoque mudou e não cobre mais a troca. Confira e tente de novo.');
    throw e;
  }
  const left = (
    await db
      .prepare(`SELECT id, qty FROM products WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`)
      .bind(outJson)
      .all<{ id: string; qty: number }>()
  ).results;
  return json({ gave: left.map((r) => ({ id: r.id, available: r.qty })), got: [...inn.values()] });
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
    if (path === '/api/colecao/troca' && method === 'POST')
      return await registerTrade(db, user, await readJson(request));
    const stockId = path.match(/^\/api\/colecao\/estoque\/([\w.!%-]{1,80})$/);
    if (stockId?.[1] && method === 'PUT') return await adjustStock(db, stockId[1], await readJson(request));
    const mark = path.match(/^\/api\/colecao\/sets\/([\w.!%-]{1,80})\/marcar$/);
    if (mark?.[1] && method === 'PUT') return await markSet(db, user, mark[1], await readJson(request));
    if (path === '/api/colecao/item' && method === 'PUT') return await setItem(db, user, await readJson(request));
  } catch (e) {
    return handleError(e, 'coleção');
  }
  return notFound();
};
