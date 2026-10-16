import { PACK_PRICE, PACK_SIZE, productById, productSubtitle } from './catalog';

export type Destination = 'send' | 'vault';

export interface CartLine {
  id: string;
  name: string;
  price: number;
  qty: number;
  color: string | null;
  sub: string;
  kind?: string;
  dest?: Destination | null;
}

export type CartResult = { ok: true; name: string } | { ok: false; error: string };

const stockLimit = (id: string): number | null => {
  const p = productById[id];
  return p?.kind === 'item' && p.status === 'estoque' ? p.qty : null;
};

/** Adiciona 1 unidade (ou cria a linha), respeitando o estoque das cartas. Muda `cart`. */
export const addToCart = (cart: CartLine[], id: string): CartResult => {
  const p = productById[id];
  if (!p) return { ok: false, error: 'item indisponível' };
  const line = cart.find((l) => l.id === id);
  const limit = stockLimit(id);
  if (line && limit !== null && line.qty >= limit) return { ok: false, error: `só ${limit} un. em estoque` };
  if (line) line.qty++;
  else
    cart.push({
      id,
      name: p.name,
      price: p.price,
      qty: 1,
      color: p.kind === 'mini' ? p.color : null,
      sub: productSubtitle(p),
      kind: p.kind,
      dest: p.kind === 'item' ? 'send' : null,
    });
  return { ok: true, name: p.name };
};

/** Muda a quantidade em ±1 (mínimo 1), respeitando o estoque. Muda `line`. */
export const changeQty = (line: CartLine, delta: number): CartResult => {
  const limit = stockLimit(line.id);
  if (delta > 0 && limit !== null && line.qty >= limit) return { ok: false, error: `só ${limit} un. em estoque` };
  line.qty = Math.max(1, line.qty + delta);
  return { ok: true, name: line.name };
};

/** Linha de pacote montado: as miniaturas escolhidas vão no subtítulo. */
export const packLine = (pack: string[], now: number): CartLine | null => {
  if (pack.length < PACK_SIZE) return null;
  const names = pack.map((id) => productById[id].name.replace('fiozinho ', '')).join(', ');
  return { id: `pack-${now}`, name: 'pacote fiozinho', price: PACK_PRICE, qty: 1, color: '#F42744', sub: names };
};

export const cartCount = (cart: CartLine[]): number => cart.reduce((a, l) => a + l.qty, 0);

/** Precisa de frete se algum item não vai para o cofre. */
export const needsShipping = (cart: CartLine[]): boolean => cart.some((l) => l.dest !== 'vault');

export const cartTotals = (cart: CartLine[], shipPrice: number | null) => {
  const sub = cart.reduce((a, l) => a + l.price * l.qty, 0);
  const ns = needsShipping(cart);
  const ship = ns && shipPrice !== null ? shipPrice : 0;
  return { sub, ship, total: sub + ship, needsShipping: ns };
};
