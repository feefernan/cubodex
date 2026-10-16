import { CARDS, type Card, cardById, ITEMS, type Item, itemName, SETS, setById } from './catalog';
import { normalize, uniq } from './format';

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

/** Quantas cartas diferentes do set a Cubodex tem à venda. */
export const cardsOnSale = (setId: string): number =>
  uniq(ITEMS.filter((it) => cardById[it.card].set === setId && it.status !== 'esgotado').map((it) => it.card)).length;

export const filterSets = (q: string, year: string) => {
  const nq = normalize(q.trim());
  return SETS.filter(
    (s) => (!nq || normalize(`${s.name} ${s.serie}`).includes(nq)) && (!year || String(s.year) === year),
  );
};

/** Cartas do set em ordem de número, com filtros de raridade e "só as que a Cubodex tem". */
export const cardsOfSet = (setId: string, rar: string, onlyOnSale: boolean): { all: Card[]; shown: Card[] } => {
  const all = CARDS.filter((c) => c.set === setId).sort((a, b) => a.n - b.n);
  const shown = all.filter((c) => (!rar || c.rar === rar) && (!onlyOnSale || itemsOfCard(c.id).length > 0));
  return { all, shown };
};
