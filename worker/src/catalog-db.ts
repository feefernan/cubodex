/**
 * Catálogo no D1 (Fase 2). O Notion é onde o dono edita; o D1 é onde o site lê e onde o estoque é baixado.
 * - O cron traz o Notion para o D1 (`syncProducts`) e leva para o Notion as baixas ainda não gravadas (`flushStock`).
 * - A baixa é um UPDATE atômico: duas vendas da mesma carta ao mesmo tempo nunca passam do estoque.
 * - `dirty` protege a baixa: enquanto o Notion não recebeu o valor novo, o sync não o sobrescreve.
 */
import type { CardRef, ProductDef } from '../../src/domain/catalog';
import type { StockRow } from '../../src/domain/stock';
import type { Db } from './accounts';
import type { Bucket } from './bucket';
import { log } from './http';
import { fetchProducts, type PhotoFile, parseStoredDef, type StoredDef, setAvailable } from './notion';
import { readPhotos, syncPhotos } from './photos';

type Fetch = typeof fetch;
type Row = Omit<StockRow, 'def'> & { def?: StoredDef; pageId: string; files?: PhotoFile[] };

interface ProductRow {
  def: string | null;
  id: string;
  price: number | null;
  qty: number | null;
  active: number;
  presale: number;
  featured: number;
}

/** Linha da carta do TCGdex com o set dela, como a leitura junta. */
interface CardJoin {
  id: string;
  local_id: string;
  name: string;
  name_pt: string | null;
  rarity: string | null;
  types: string | null;
  image: string | null;
  set_id: string;
  set_name: string;
  set_pt: string | null;
  total: number;
  official: number;
}

/** As cartas do TCGdex (com o set) que as linhas do Notion citam; poucas por vez, por causa do limite de parâmetros. */
const loadCards = async (db: Db, ids: string[]) => {
  const out = new Map<string, CardJoin>();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const rows = (
      await db
        .prepare(
          `SELECT c.id, c.local_id, c.name, c.name_pt, c.rarity, c.types, c.image, s.id AS set_id, s.name AS set_name,
            s.name_pt AS set_pt, s.total, s.official
           FROM tcg_cards c JOIN tcg_sets s ON s.id = c.set_id WHERE c.id IN (${part.map(() => '?').join(', ')})`,
        )
        .bind(...part)
        .all<CardJoin>()
    ).results;
    for (const r of rows) out.set(r.id, r);
  }
  return out;
};

/** A carta de uma linha do Notion: o que a loja mostra dela (nome no idioma do item, set, número, raridade, imagem). */
const cardRef = (c: CardJoin, lang: string): CardRef => ({
  id: c.id,
  setId: c.set_id,
  setName: c.set_name,
  number: c.local_id,
  total: c.official || c.total,
  name: lang === 'PT' && c.name_pt ? c.name_pt : c.name,
  rarity: c.rarity ?? '',
  types: c.types ?? '',
  image: c.image,
  pt: c.set_pt !== null,
});

/**
 * Produtos no formato que o domínio já usa (`applyStock`) e que `/api/catalog` devolve. A carta à venda sai com a
 * carta do TCGdex junta: se o id do Notion não existe na enciclopédia, a linha fica sem descrição (e o log avisa).
 */
export const readProducts = async (db: Db): Promise<StockRow[]> => {
  const photos = await readPhotos(db);
  const rows = (
    await db.prepare('SELECT id, price, qty, active, presale, featured, def FROM products').all<ProductRow>()
  ).results;
  const defs = new Map(rows.map((r) => [r.id, parseStored(r.def)]));
  const specs = [...defs.values()].flatMap((d) => (d?.kind === 'item' ? [d] : []));
  const cards = specs.length
    ? await loadCards(db, [...new Set(specs.map((s) => s.tcgdex))])
    : new Map<string, CardJoin>();
  return rows.map((r): StockRow => {
    const d = defs.get(r.id);
    let def: ProductDef | undefined;
    if (d?.kind === 'item') {
      const c = cards.get(d.tcgdex);
      if (c)
        def = {
          kind: 'item',
          card: cardRef(c, d.lang),
          lang: d.lang,
          variant: d.variant,
          grade: d.grade,
          created: d.created,
        };
      else log('warn', 'carta do Notion que não está na enciclopédia', { id: r.id, tcgdex: d.tcgdex });
    } else if (d) def = d;
    return {
      id: r.id,
      price: r.price,
      available: r.qty,
      active: r.active === 1,
      presale: r.presale === 1,
      ...(r.featured === 1 ? { featured: true } : {}),
      photos: photos.get(r.id) ?? [],
      ...(def && { def }),
    };
  });
};

/** O JSON guardado no D1 passa de novo pela validação do domínio (um valor estragado vira "sem descrição"). */
const parseStored = (json: string | null): StoredDef | null => {
  try {
    return json ? parseStoredDef(JSON.parse(json)) : null;
  } catch {
    return null;
  }
};

const UPSERT = `INSERT INTO products (id, price, qty, active, presale, page_id, synced_at, def, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET price = excluded.price, def = excluded.def,
    qty = CASE WHEN products.dirty = 1 THEN products.qty ELSE excluded.qty END,
    active = excluded.active, presale = excluded.presale, featured = excluded.featured, page_id = excluded.page_id, synced_at = excluded.synced_at`;

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
          db
            .prepare(UPSERT)
            .bind(
              r.id,
              r.price,
              r.available,
              r.active ? 1 : 0,
              r.presale ? 1 : 0,
              r.pageId,
              now,
              r.def ? JSON.stringify(r.def) : null,
              r.featured ? 1 : 0,
            ),
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
