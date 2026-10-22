import { type Card, cardById, ITEMS, type Item, itemName, setById } from './catalog';
import { normalize } from './format';

export interface Filters {
  q: string;
  set: string;
  rar: string;
  tipo: string;
  lang: string;
  variant: string;
  graded: boolean;
  stock: boolean;
  min: string;
  max: string;
  sort: 'recentes' | 'menor' | 'maior' | 'az';
}

export const emptyFilters = (): Filters => ({
  q: '',
  set: '',
  rar: '',
  tipo: '',
  lang: '',
  variant: '',
  graded: false,
  stock: false,
  min: '',
  max: '',
  sort: 'recentes',
});

const matches = (it: Item, f: Filters): boolean => {
  const c = cardById[it.card];
  const q = normalize(f.q.trim());
  const min = Number.parseFloat(f.min);
  const max = Number.parseFloat(f.max);
  if (q && !normalize(`${itemName(it)} ${setById[c.set].name}`).includes(q)) return false;
  if (f.set && c.set !== f.set) return false;
  if (f.rar && c.rar !== f.rar) return false;
  if (f.tipo && c.tipo !== f.tipo) return false;
  if (f.lang && it.lang !== f.lang) return false;
  if (f.variant && it.variant !== f.variant) return false;
  if (f.graded && !it.grade) return false;
  if (f.stock && it.status !== 'estoque') return false;
  if (!Number.isNaN(min) && it.price < min) return false;
  if (!Number.isNaN(max) && it.price > max) return false;
  return true;
};

const SORTS: Record<Filters['sort'], (a: Item, b: Item) => number> = {
  recentes: (a, b) => a.added - b.added,
  menor: (a, b) => a.price - b.price,
  maior: (a, b) => b.price - a.price,
  az: (a, b) => itemName(a).localeCompare(itemName(b), 'pt'),
};

export const filterItems = (f: Filters, items: Item[] = ITEMS): Item[] =>
  items.filter((it) => matches(it, f)).sort(SORTS[f.sort] ?? SORTS.recentes);

/** Itens à venda (não esgotados) de uma carta. */
export const itemsOfCard = (cardId: string): Item[] =>
  ITEMS.filter((it) => it.card === cardId && it.status !== 'esgotado');

/**
 * A enciclopédia fala em ids do TCGdex; o catálogo de exemplo ainda usa ids próprios (`jungle-11`). Esta ponte dá o id
 * do TCGdex de cada carta à venda, para mostrar "à venda na Cubodex" nas páginas da enciclopédia. Some na 3.3, quando
 * as cartas à venda passam a vir do Notion já com o id do TCGdex.
 */
const tcgdexSetId = (c: Card): string => setById[c.set].tcgdex.split('/')[1];
export const tcgdexCardId = (c: Card): string => `${tcgdexSetId(c)}-${String(c.n).padStart(setById[c.set].pad, '0')}`;

/** Itens à venda (não esgotados) de uma carta do TCGdex. */
export const itemsOfTcgdexCard = (id: string): Item[] =>
  ITEMS.filter((it) => it.status !== 'esgotado' && tcgdexCardId(cardById[it.card]) === id);

/** Quantas cartas diferentes de cada set do TCGdex a Cubodex tem à venda. */
export const onSaleBySet = (): Map<string, number> => {
  const cards = new Map<string, Set<string>>();
  for (const it of ITEMS) {
    if (it.status === 'esgotado') continue;
    const c = cardById[it.card];
    cards.set(tcgdexSetId(c), (cards.get(tcgdexSetId(c)) ?? new Set()).add(c.id));
  }
  return new Map([...cards].map(([set, ids]) => [set, ids.size]));
};
