import { ITEMS, type Item, itemName, type Product } from './catalog';
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
  sort: 'recentes' | 'menor' | 'maior' | 'az' | 'za';
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
  za: (a, b) => itemName(b).localeCompare(itemName(a), 'pt'),
};

/** Carta fora de venda (inativa no Notion) não aparece; esgotada, sim. */
const shown = (it: Item) => it.listed !== false;

/** Esgotados vão para o fim da lista, sem mexer na ordem de cada grupo (o sort é estável). */
const soldOutLast = <T>(list: T[], soldOut: (x: T) => boolean): T[] => [
  ...list.filter((x) => !soldOut(x)),
  ...list.filter(soldOut),
];

export const filterItems = (f: Filters, items: Item[] = ITEMS): Item[] =>
  soldOutLast(
    items.filter((it) => shown(it) && matches(it, f)).sort(SORTS[f.sort] ?? SORTS.recentes),
    (it) => it.status === 'esgotado',
  );

// ───────── selados e acessórios ─────────

type Shelf = Extract<Product, { kind: 'acc' }>;

export interface ShelfFilters {
  q: string;
  group: 'all' | 'lacrado' | 'acc';
  set: string;
  lang: string;
  subtype: string;
  color: string;
  stock: boolean;
  min: string;
  max: string;
  sort: 'padrao' | 'menor' | 'maior' | 'az' | 'za';
}

export const emptyShelf = (): ShelfFilters => ({
  q: '',
  group: 'all',
  set: '',
  lang: '',
  subtype: '',
  color: '',
  stock: false,
  min: '',
  max: '',
  sort: 'padrao',
});

const SHELF_SORTS: Record<ShelfFilters['sort'], (a: Shelf, b: Shelf) => number> = {
  padrao: () => 0,
  menor: (a, b) => a.price - b.price,
  maior: (a, b) => b.price - a.price,
  az: (a, b) => a.name.localeCompare(b.name, 'pt'),
  za: (a, b) => b.name.localeCompare(a.name, 'pt'),
};

const isSealed = (p: Shelf) => p.group === 'lacrado';

/**
 * Opções dos filtros do grupo escolhido. Selados: coleção, idioma e tipo; acessórios: tipo e cor (não têm coleção nem
 * idioma). "Todos" só tem preço e estoque, que valem para os dois.
 */
export const shelfOptions = (all: Product[], group: ShelfFilters['group'] = 'all') => {
  const list = all.filter((p): p is Shelf => p.kind === 'acc');
  const sealed = list.filter(isSealed);
  const acc = list.filter((p) => !isSealed(p));
  const sorted = (xs: (string | undefined)[]) =>
    uniq(xs.filter((x): x is string => !!x)).sort((a, b) => a.localeCompare(b, 'pt'));
  return {
    sets: sorted(sealed.map((p) => p.set)),
    langs: sorted(sealed.map((p) => p.lang)),
    subtypes: group === 'all' ? [] : sorted((group === 'lacrado' ? sealed : acc).map((p) => p.subtype)),
    colors: sorted(acc.map((p) => p.color)),
  };
};

export const filterShelf = (all: Product[], f: ShelfFilters): Shelf[] => {
  const q = normalize(f.q.trim());
  const min = Number.parseFloat(f.min);
  const max = Number.parseFloat(f.max);
  // Cada tipo de produto só usa os filtros que tem: um filtro guardado do outro lado não esconde nada.
  const sealed = f.group === 'lacrado';
  const acc = f.group === 'acc';
  const out = all
    .filter((p): p is Shelf => p.kind === 'acc')
    .filter((p) => {
      if (f.group !== 'all' && isSealed(p) !== sealed) return false;
      if (q && !normalize(`${p.name} ${p.set ?? ''} ${p.subtype ?? ''} ${p.color ?? ''} ${p.note}`).includes(q))
        return false;
      if (sealed && f.set && p.set !== f.set) return false;
      if (sealed && f.lang && p.lang !== f.lang) return false;
      if (f.group !== 'all' && f.subtype && p.subtype !== f.subtype) return false;
      if (acc && f.color && p.color !== f.color) return false;
      if (!acc && f.stock && p.qty === 0) return false;
      if (!Number.isNaN(min) && p.price < min) return false;
      if (!Number.isNaN(max) && p.price > max) return false;
      return true;
    })
    .sort(SHELF_SORTS[f.sort] ?? SHELF_SORTS.padrao);
  return soldOutLast(out, (p) => p.qty === 0);
};

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

// ───────── destaques da página inicial ─────────

const NO_ESTOQUE = (p: Shelf) => p.qty !== 0;

/**
 * Destaques de TCG: o que está marcado "Destaque" no Notion (cartas e selados, só o que tem estoque), até 8.
 * Sem nenhum marcado, mostra as 4 cartas mais recentes em estoque, para a home nunca ficar vazia.
 */
export const tcgHighlights = (cards: Item[] = ITEMS, shelf: Product[] = []): (Item | Shelf)[] => {
  const live = cards.filter((it) => shown(it) && it.status !== 'esgotado');
  const chosen: (Item | Shelf)[] = [
    ...live.filter((it) => it.featured).sort((a, b) => a.added - b.added),
    ...shelf.filter((p): p is Shelf => p.kind === 'acc' && !!p.featured && NO_ESTOQUE(p)),
  ];
  return chosen.length ? chosen.slice(0, 8) : [...live].sort((a, b) => a.added - b.added).slice(0, 4);
};

/** Destaques de "criar": peças marcadas no Notion (até 8); sem nenhuma, as 4 primeiras. */
export const craftHighlights = (crafts: Product[]): Product[] => {
  const chosen = crafts.filter((p) => p.featured);
  return chosen.length ? chosen.slice(0, 8) : crafts.slice(0, 4);
};
