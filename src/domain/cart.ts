import { PACK_PRICE, PACK_SIZE, type Product, productById, productSubtitle } from './catalog';

export type Destination = 'send' | 'vault';

/** O que o carrinho guarda: só referência e quantidade. Preço e nome vêm sempre do catálogo. */
export interface CartEntry {
  id: string;
  qty: number;
  dest?: Destination;
  /** Pacote montado: as miniaturas escolhidas. */
  pack?: string[];
}

/** Linha pronta para mostrar e somar, montada a partir do catálogo atual. */
export interface CartLine extends CartEntry {
  name: string;
  price: number;
  color: string | null;
  sub: string;
  kind: Product['kind'] | 'pack';
}

/** Máximo por linha (o mesmo limite do servidor). */
const MAX_QTY = 99;

export type CartResult = { ok: true; name: string } | { ok: false; error: string };

const isMini = (id: string) => productById[id]?.kind === 'mini';

/** Quantas unidades existem de uma carta (estoque ou pré-venda); null = sem limite (peça impressa sob demanda). */
const stockLimit = (id: string): number | null => {
  const p = productById[id];
  if (p?.kind !== 'item') return null;
  return p.status === 'esgotado' ? 0 : p.qty;
};

/** Monta a linha a partir do catálogo; null quando o item não existe mais ou esgotou. */
export const describeEntry = (e: CartEntry): CartLine | null => {
  if (e.pack) {
    if (e.pack.length !== PACK_SIZE || !e.pack.every(isMini)) return null;
    const names = e.pack.map((id) => productById[id].name.replace('fiozinho ', '')).join(', ');
    return {
      id: e.id,
      qty: e.qty,
      pack: e.pack,
      name: 'pacote fiozinho',
      price: PACK_PRICE,
      color: '#F42744',
      sub: names,
      kind: 'pack',
    };
  }
  const p = productById[e.id];
  const limit = stockLimit(e.id);
  if (!p || limit === 0) return null;
  return {
    id: e.id,
    qty: limit === null ? e.qty : Math.min(e.qty, limit),
    dest: p.kind === 'item' ? (e.dest ?? 'send') : undefined,
    name: p.name,
    price: p.price,
    color: p.kind === 'mini' ? p.color : null,
    sub: productSubtitle(p),
    kind: p.kind,
  };
};

/** Linhas válidas do carrinho; `dropped` conta as que saíram (item sumiu ou esgotou). */
export const resolveCart = (cart: CartEntry[]) => {
  const lines = cart.map(describeEntry).filter((l): l is CartLine => l !== null);
  return { lines, dropped: cart.length - lines.length };
};

/** Só os campos que o carrinho guarda. */
export const toEntry = ({ id, qty, dest, pack }: CartLine): CartEntry => ({
  id,
  qty,
  ...(dest ? { dest } : {}),
  ...(pack ? { pack } : {}),
});

/** Adiciona 1 unidade (ou cria a linha), respeitando o estoque das cartas. Muda `cart`. */
export const addToCart = (cart: CartEntry[], id: string): CartResult => {
  const p = productById[id];
  const limit = stockLimit(id);
  if (!p || limit === 0) return { ok: false, error: 'item indisponível' };
  const line = cart.find((l) => l.id === id);
  const qty = line?.qty ?? 0;
  if (limit !== null && qty >= limit) return { ok: false, error: `só ${limit} un. em estoque` };
  if (qty >= MAX_QTY) return { ok: false, error: `no máximo ${MAX_QTY} un. por item` };
  if (line) line.qty++;
  else cart.push(p.kind === 'item' ? { id, qty: 1, dest: 'send' } : { id, qty: 1 });
  return { ok: true, name: p.name };
};

/** Muda a quantidade em ±1 (mínimo 1), respeitando o estoque. Muda `entry`. */
export const changeQty = (entry: CartEntry, delta: number): CartResult => {
  const limit = stockLimit(entry.id);
  if (delta > 0 && limit !== null && entry.qty >= limit) return { ok: false, error: `só ${limit} un. em estoque` };
  if (delta > 0 && entry.qty >= MAX_QTY) return { ok: false, error: `no máximo ${MAX_QTY} un. por item` };
  entry.qty = Math.max(1, entry.qty + delta);
  return { ok: true, name: entry.id };
};

/** Pacote montado com as miniaturas escolhidas; null enquanto faltam miniaturas. */
export const packEntry = (pack: string[], now: number): CartEntry | null =>
  pack.length === PACK_SIZE && pack.every(isMini) ? { id: `pack-${now}`, qty: 1, pack: [...pack] } : null;

export const cartCount = (cart: CartEntry[]): number => cart.reduce((a, l) => a + l.qty, 0);

/** Precisa de frete se algum item não vai para o cofre. */
export const needsShipping = (lines: CartLine[]): boolean => lines.some((l) => l.dest !== 'vault');

export const cartTotals = (lines: CartLine[], shipPrice: number | null) => {
  const sub = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const ns = needsShipping(lines);
  const ship = ns && shipPrice !== null ? shipPrice : 0;
  return { sub, ship, total: sub + ship, needsShipping: ns };
};

const isQty = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_QTY;
/** Id de linha de pacote: nunca o id de um produto (senão um pacote forjado baixaria o estoque de uma carta). */
const PACK_ID = /^pack-\d+$/;

/** Carrinho vindo de fora (localStorage ou corpo do pedido): só entradas com forma e ids válidos. */
export const parseCartEntries = (raw: unknown): CartEntry[] =>
  Array.isArray(raw)
    ? raw.flatMap((v): CartEntry[] => {
        const o = v as Record<string, unknown>;
        if (!o || typeof o !== 'object' || typeof o.id !== 'string' || o.id.length > 40 || !isQty(o.qty)) return [];
        if (Array.isArray(o.pack)) {
          if (!PACK_ID.test(o.id)) return [];
          const pack = o.pack.filter((id): id is string => typeof id === 'string' && isMini(id));
          return pack.length === o.pack.length ? [{ id: o.id, qty: o.qty, pack }] : [];
        }
        const dest = o.dest === 'vault' || o.dest === 'send' ? o.dest : undefined;
        return productById[o.id] ? [{ id: o.id, qty: o.qty, ...(dest ? { dest } : {}) }] : [];
      })
    : [];
