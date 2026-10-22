/**
 * Catálogo no D1 (Fase 2). O Notion é onde o dono edita; o D1 é onde o site lê e onde o estoque é baixado.
 * - O cron traz o Notion para o D1 (`syncProducts`) e leva para o Notion as baixas ainda não gravadas (`flushStock`).
 * - A baixa é um UPDATE atômico: duas vendas da mesma carta ao mesmo tempo nunca passam do estoque.
 * - `dirty` protege a baixa: enquanto o Notion não recebeu o valor novo, o sync não o sobrescreve.
 */
import type { StockRow } from '../../src/domain/stock';
import type { Db } from './accounts';
import type { Bucket } from './bucket';
import { log } from './http';
import { fetchProducts, type PhotoFile, setAvailable } from './notion';
import { readPhotos, syncPhotos } from './photos';

type Fetch = typeof fetch;
type Row = StockRow & { pageId: string; files?: PhotoFile[] };

interface ProductRow {
  id: string;
  price: number | null;
  qty: number | null;
  active: number;
  presale: number;
}

/** Produtos no formato que o domínio já usa (`applyStock`) e que `/api/catalog` devolve. */
export const readProducts = async (db: Db): Promise<StockRow[]> => {
  const photos = await readPhotos(db);
  return (await db.prepare('SELECT id, price, qty, active, presale FROM products').all<ProductRow>()).results.map(
    (r) => ({
      id: r.id,
      price: r.price,
      available: r.qty,
      active: r.active === 1,
      presale: r.presale === 1,
      photos: photos.get(r.id) ?? [],
    }),
  );
};

const UPSERT = `INSERT INTO products (id, price, qty, active, presale, page_id, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET price = excluded.price,
    qty = CASE WHEN products.dirty = 1 THEN products.qty ELSE excluded.qty END,
    active = excluded.active, presale = excluded.presale, page_id = excluded.page_id, synced_at = excluded.synced_at`;

/**
 * Traz as linhas do Notion para o D1, sem desfazer baixa pendente. Produto que sumiu do Notion fica inativo
 * (não é apagado: pedidos antigos ainda o citam). Sem linhas, não mexe em nada: um Notion fora do ar não esvazia a loja.
 */
export const syncProducts = async (db: Db, rows: Row[], now = new Date().toISOString()) => {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 50)
    await db.batch(
      rows
        .slice(i, i + 50)
        .map((r) =>
          db.prepare(UPSERT).bind(r.id, r.price, r.available, r.active ? 1 : 0, r.presale ? 1 : 0, r.pageId, now),
        ),
    );
  await db.prepare('UPDATE products SET active = 0 WHERE synced_at <> ?').bind(now).run();
  return rows.length;
};

/**
 * Baixa o estoque de um pedido pago, uma carta por vez e retomável (`from`). Devolve as cartas que não tinham
 * estoque suficiente: o pedido foi pago, então a loja precisa reembolsar. Produto sem controle de estoque
 * (qty nulo) ou fora da tabela não é tocado.
 */
export const takeStock = async (
  db: Db,
  items: { id: string; qty: number }[],
  from: number,
  onEach: (done: number) => Promise<unknown>,
) => {
  const short: string[] = [];
  for (let i = from; i < items.length; i++) {
    const { id, qty } = items[i];
    const took = await db
      .prepare(
        'UPDATE products SET qty = qty - ?, dirty = 1 WHERE id = ? AND qty IS NOT NULL AND qty >= ? RETURNING qty',
      )
      .bind(qty, id, qty)
      .first();
    if (!took) {
      const row = await db.prepare('SELECT qty FROM products WHERE id = ?').bind(id).first<{ qty: number | null }>();
      if (row && row.qty !== null) short.push(id);
    }
    await onEach(i + 1);
  }
  return short;
};

/**
 * Leva para o Notion as baixas que ainda não foram gravadas. Só marca como gravada se o estoque não mudou
 * desde a leitura: uma venda no meio do caminho deixa o produto pendente para a próxima rodada.
 */
export const flushStock = async (db: Db, f: Fetch, token: string, limit = 20) => {
  const pending = (
    await db
      .prepare("SELECT id, qty, page_id FROM products WHERE dirty = 1 AND page_id <> '' AND qty IS NOT NULL LIMIT ?")
      .bind(limit)
      .all<{ id: string; qty: number; page_id: string }>()
  ).results;
  let done = 0;
  for (const p of pending) {
    try {
      await setAvailable(f, token, p.page_id, p.qty);
      await db.prepare('UPDATE products SET dirty = 0 WHERE id = ? AND qty = ?').bind(p.id, p.qty).run();
      done++;
    } catch (e) {
      log('warn', 'estoque ainda não gravado no Notion', { id: p.id, error: String(e) });
    }
  }
  return done;
};

/** Uma rodada do cron: grava as baixas pendentes, traz o Notion de volta e copia as fotos novas para o R2. */
export const refreshCatalog = async (
  db: Db,
  env: { NOTION_TOKEN?: string; NOTION_PRODUCTS_DB: string; FOTOS?: Bucket },
  f: Fetch,
) => {
  if (!env.NOTION_TOKEN || !env.NOTION_PRODUCTS_DB) return 0;
  await flushStock(db, f, env.NOTION_TOKEN);
  const rows = await fetchProducts(f, env.NOTION_TOKEN, env.NOTION_PRODUCTS_DB);
  const synced = await syncProducts(db, rows);
  // Fotos não derrubam o catálogo: o que não copiou agora tenta de novo na próxima rodada.
  if (env.FOTOS)
    await syncPhotos(db, env.FOTOS, rows, f).catch((e) => log('warn', 'fotos não copiadas', { error: String(e) }));
  return synced;
};
