import {
  defineItem,
  defineProduct,
  ITEMS,
  PACK,
  PRODUCTS,
  type ProductDef,
  parseDef,
  productById,
  type StockStatus,
} from './catalog';

/** Uma linha do banco Produtos do Notion: o que a loja controla sem mudar código. */
export interface StockRow {
  id: string;
  price: number | null;
  /** Unidades disponíveis (só cartas; peças impressas são feitas sob demanda). */
  available: number | null;
  active: boolean;
  presale: boolean;
  /** Chaves das fotos próprias no R2 (vazio = sem foto própria). */
  photos?: string[];
  /** Descrição do produto (miniatura, peça, acessório) ou o desconto do pacote; cartas ainda vêm do código. */
  def?: ProductDef;
}

/** Chave de foto no R2: `fotos/<id do produto>/<16 hex>.<extensão de imagem>`. */
export const PHOTO_KEY = /^fotos\/[A-Za-z0-9-]+\/[0-9a-f]{16}\.(?:jpe?g|png|webp|gif)$/;

const statusOf = (row: StockRow): StockStatus => {
  if (!row.active || row.available === 0) return 'esgotado';
  return row.presale ? 'prevenda' : 'estoque';
};

/**
 * Aplica preço e estoque do Notion ao catálogo em memória (site e Worker usam o mesmo).
 * Ids desconhecidos são ignorados e devolvidos, para o log. Produto que não está no Notion, ou está sem
 * "Ativo no site", sai de venda (`listed = false`): vale para cartas, miniaturas, peças e acessórios.
 */
export const applyStock = (rows: StockRow[]): string[] => {
  const unknown: string[] = [];
  for (const row of rows) {
    // Só a linha "pack" manda no pacote de miniaturas: outra linha com Tipo "pacote" não muda o desconto.
    if (row.def?.kind === 'pack') {
      if (row.id === 'pack') PACK.discount = row.def.discount;
    } else if (row.def?.kind === 'item') defineItem(row.id, row.def, row.price);
    else if (row.def) defineProduct(row.id, row.def, row.price);
  }
  const active = new Set(rows.filter((r) => r.active).map((r) => r.id));
  PACK.listed = active.has('pack');
  for (const p of PRODUCTS) {
    // Sem preço não vende: produto novo sem preço no Notion fica fora de venda até alguém preencher.
    p.listed = active.has(p.id) && p.price > 0;
    if (p.kind === 'item') {
      const item = ITEMS.find((it) => it.id === p.id);
      if (item) item.listed = p.listed;
      if (!p.listed) {
        p.status = 'esgotado';
        if (item) item.status = 'esgotado';
      }
    }
  }
  // Id reaproveitado no Notion para outro tipo de produto (ex.: o i1 de exemplo virou um deck box): a carta de
  // exemplo que sobrou no código não é mais um produto à venda.
  for (const it of ITEMS) if (productById[it.id]?.kind !== 'item') it.listed = false;
  for (const row of rows) {
    const p = productById[row.id];
    if (!p) {
      if (row.id === 'pack') continue;
      unknown.push(row.id);
      continue;
    }
    if (row.price !== null && row.price >= 0) p.price = row.price;
    p.photos = row.photos ?? [];
    if (p.kind === 'acc') p.qty = row.available === null ? undefined : Math.max(0, Math.floor(row.available));
    if (p.kind !== 'item') continue;
    const item = ITEMS.find((it) => it.id === row.id);
    p.status = statusOf(row);
    if (row.available !== null) p.qty = Math.max(0, Math.floor(row.available));
    if (item) Object.assign(item, { price: p.price, qty: p.qty, status: p.status, photos: p.photos });
  }
  return unknown;
};

/** Valida o que veio da API antes de aplicar (o navegador também recebe isso). */
export const parseStockRows = (data: unknown): StockRow[] => {
  const rows = (data as { products?: unknown })?.products;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const o = r as Record<string, unknown>;
    if (typeof o?.id !== 'string') return [];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return [
      {
        id: o.id,
        price: num(o.price),
        available: num(o.available),
        active: o.active !== false,
        presale: o.presale === true,
        photos: Array.isArray(o.photos)
          ? o.photos.filter((k): k is string => typeof k === 'string' && PHOTO_KEY.test(k))
          : [],
        ...(parseDef(o.def) && { def: parseDef(o.def) as ProductDef }),
      },
    ];
  });
};
