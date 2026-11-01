import { ITEMS, type Item, itemName } from './catalog';
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
  const c = it.card;
  const q = normalize(f.q.trim());
  const min = Number.parseFloat(f.min);
  const max = Number.parseFloat(f.max);
  if (q && !normalize(`${itemName(it)} ${c.setName}`).includes(q)) return false;
  if (f.set && c.setId !== f.set) return false;
  if (f.rar && c.rarity !== f.rar) return false;
  if (f.tipo && !c.types.split(',').includes(f.tipo)) return false;
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

/** Carta fora de venda (inativa no Notion) não aparece; esgotada, sim. */
const shown = (it: Item) => it.listed !== false;

export const filterItems = (f: Filters, items: Item[] = ITEMS): Item[] =>
  items.filter((it) => shown(it) && matches(it, f)).sort(SORTS[f.sort] ?? SORTS.recentes);

/** Itens à venda (não esgotados) de uma carta do TCGdex. */
export const itemsOfTcgdexCard = (id: string): Item[] =>
  ITEMS.filter((it) => shown(it) && it.status !== 'esgotado' && it.card.id === id);

/** Quantas cartas diferentes de cada set do TCGdex a Cubodex tem à venda. */
export const onSaleBySet = (): Map<string, number> => {
  const cards = new Map<string, Set<string>>();
  for (const it of ITEMS) {
    if (!shown(it) || it.status === 'esgotado') continue;
    cards.set(it.card.setId, (cards.get(it.card.setId) ?? new Set()).add(it.card.id));
  }
  return new Map([...cards].map(([set, ids]) => [set, ids.size]));
};

/** As opções dos filtros da página "cartas à venda" vêm das próprias cartas à venda: carta nova entra sozinha. */
export const filterOptions = (all: Item[] = ITEMS) => {
  const items = all.filter(shown);
  return {
    sets: [...new Map(items.map((it) => [it.card.setId, it.card.setName])).entries()].sort((a, b) =>
      a[1].localeCompare(b[1]),
    ),
    rarities: uniq(items.map((it) => it.card.rarity).filter(Boolean)).sort(),
    types: uniq(items.flatMap((it) => it.card.types.split(',').filter(Boolean))).sort(),
    langs: uniq(items.map((it) => it.lang)).sort(),
    variants: uniq(items.map((it) => it.variant)).sort(),
  };
};

/** Tipo e variante do TCGdex, em português (o valor do filtro continua o do TCGdex). */
export const TYPE_PT: Record<string, string> = {
  Fire: 'fogo',
  Water: 'água',
  Grass: 'planta',
  Lightning: 'elétrico',
  Psychic: 'psíquico',
  Fighting: 'lutador',
  Darkness: 'sombrio',
  Metal: 'metal',
  Dragon: 'dragão',
  Colorless: 'incolor',
  Fairy: 'fada',
};
export const VARIANT_PT: Record<string, string> = {
  normal: 'normal',
  reverse: 'reverse holo',
  holo: 'holo',
  firstEdition: '1ª edição',
};
