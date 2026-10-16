import { ITEMS, productById, type StockStatus } from './catalog';

/** Uma linha do banco Produtos do Notion: o que a loja controla sem mudar código. */
export interface StockRow {
  id: string;
  price: number | null;
  /** Unidades disponíveis (só cartas; peças impressas são feitas sob demanda). */
  available: number | null;
  active: boolean;
  presale: boolean;
}

const statusOf = (row: StockRow): StockStatus => {
  if (!row.active || row.available === 0) return 'esgotado';
  return row.presale ? 'prevenda' : 'estoque';
};

/**
 * Aplica preço e estoque do Notion ao catálogo em memória (site e Worker usam o mesmo).
 * Ids desconhecidos são ignorados e devolvidos, para o log.
 */
export const applyStock = (rows: StockRow[]): string[] => {
  const unknown: string[] = [];
  for (const row of rows) {
    const p = productById[row.id];
    if (!p) {
      unknown.push(row.id);
      continue;
    }
    if (row.price !== null && row.price >= 0) p.price = row.price;
    if (p.kind !== 'item') continue;
    const item = ITEMS.find((it) => it.id === row.id);
    p.status = statusOf(row);
    if (row.available !== null) p.qty = Math.max(0, Math.floor(row.available));
    if (item) Object.assign(item, { price: p.price, qty: p.qty, status: p.status });
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
      },
    ];
  });
};
