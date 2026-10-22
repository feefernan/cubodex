/* Dados de exemplo do protótipo. A fonte real dos sets e cartas será o TCGdex (#15, #16). */
import { pad3 } from './format';

type Rarity = 'comum' | 'rara' | 'especial';
export type StockStatus = 'estoque' | 'esgotado' | 'prevenda';

interface Grade {
  co: string;
  n: number;
}

interface BaseProduct {
  id: string;
  name: string;
  price: number;
  /**
   * O Notion manda: só vende o que está lá com "Ativo no site". Falso = fora de venda (some das vitrines e o
   * servidor recusa). Indefinido = ainda não consultamos o Notion (desenvolvimento sem API): o catálogo de exemplo vale.
   */
  listed?: boolean;
  /** Chaves das fotos próprias (copiadas do Notion para o R2), na ordem do Notion. */
  photos?: string[];
}
interface Accessory extends BaseProduct {
  kind: 'acc';
  note: string;
}
interface Craft extends BaseProduct {
  kind: 'craft';
  spec: [string, string][];
  note: string;
}
export interface Mini extends BaseProduct {
  kind: 'mini';
  n: number;
  rar: Rarity;
  color: string;
}
interface SaleItem extends BaseProduct {
  kind: 'item';
  qty: number;
  status: StockStatus;
  lang: string;
  variant: string;
  grade: Grade | null;
}
export type Product = Accessory | Craft | Mini | SaleItem;

/** Endereço da foto própria no site: o Worker serve do R2 (as chaves são fixas, então o navegador guarda por 1 ano). */
export const photoUrl = (key: string): string => `/api/img/${key}`;

export const isListed = (p: Product | undefined): p is Product => !!p && p.listed !== false;

export interface TcgSet {
  id: string;
  name: string;
  serie: string;
  year: number;
  total: number;
  tone: string;
  langs: string[];
  /** Pasta do set no CDN do TCGdex (`<série>/<set>`) e quantos dígitos o número da carta tem lá. */
  tcgdex: string;
  pad: number;
}
export interface Card {
  id: string;
  set: string;
  n: number;
  name: string;
  rar: string;
  tipo: string;
}
export interface Item {
  id: string;
  photos?: string[];
  card: string;
  variant: string;
  lang: string;
  price: number;
  qty: number;
  grade?: Grade;
  status: StockStatus;
  added: number;
}

// Dados de exemplo: literais não são regra, ficam fora do teste de mutação.
// Stryker disable all
const VARIANTS: [string, string, Rarity][] = [
  ['base', '#F42744', 'comum'],
  ['ciano', '#3ED9F0', 'comum'],
  ['preto fosco', '#3A434F', 'comum'],
  ['branco', '#EDEFF2', 'comum'],
  ['cinza', '#7A8595', 'comum'],
  ['vermelho sombra', '#C0223B', 'rara'],
  ['dourado', '#D9A441', 'rara'],
  ['prata', '#B8C0CC', 'rara'],
  ['translúcido', '#8FE3F2', 'rara'],
  ['brilha no escuro', '#A6F2A0', 'especial'],
  ['madeira', '#B8875A', 'especial'],
  ['mármore', '#C9CDD6', 'especial'],
];
const MINI_PRICE: Record<Rarity, number> = { comum: 22, rara: 29, especial: 39 };

export const PACK_SIZE = 3;
export const PACK_PRICE = 54;
// shortcut: data do lançamento da série 01 ainda não definida (#15); vazio = "em breve". Formato: '2026-11-14T12:00:00-03:00'.
export const LAUNCH_DATE = '';

export const SERIES = [
  { id: 's1', label: 'série 01', name: 'fiozinho', open: true },
  { id: 's2', label: 'série 02', name: 'em breve', open: false },
];

export const SETS: TcgSet[] = [
  {
    id: 'base1',
    name: 'Base Set',
    serie: 'Base',
    year: 1999,
    total: 102,
    tone: '#F42744',
    langs: ['EN'],
    tcgdex: 'base/base1',
    pad: 1,
  },
  {
    id: 'jungle',
    name: 'Jungle',
    serie: 'Base',
    year: 1999,
    total: 64,
    tone: '#3ED9F0',
    langs: ['EN'],
    tcgdex: 'base/base2',
    pad: 1,
  },
  {
    id: 'fossil',
    name: 'Fossil',
    serie: 'Base',
    year: 1999,
    total: 62,
    tone: '#D9A441',
    langs: ['EN'],
    tcgdex: 'base/base3',
    pad: 1,
  },
  {
    id: 'sv151',
    name: '151',
    serie: 'Escarlate e Violeta',
    year: 2023,
    total: 165,
    tone: '#8FE3F2',
    langs: ['PT', 'EN'],
    tcgdex: 'sv/sv03.5',
    pad: 3,
  },
];

export const CARDS: Card[] = (
  [
    ['base1', 1, 'alakazam', 'rara holo', 'psíquico'],
    ['base1', 2, 'blastoise', 'rara holo', 'água'],
    ['base1', 4, 'charizard', 'rara holo', 'fogo'],
    ['base1', 10, 'mewtwo', 'rara holo', 'psíquico'],
    ['base1', 15, 'venusaur', 'rara holo', 'planta'],
    ['base1', 58, 'pikachu', 'comum', 'elétrico'],
    ['jungle', 5, 'kangaskhan', 'rara holo', 'incolor'],
    ['jungle', 11, 'snorlax', 'rara holo', 'incolor'],
    ['jungle', 12, 'vaporeon', 'rara holo', 'água'],
    ['jungle', 60, 'pikachu', 'comum', 'elétrico'],
    ['fossil', 4, 'dragonite', 'rara holo', 'incolor'],
    ['fossil', 5, 'gengar', 'rara holo', 'psíquico'],
    ['fossil', 10, 'lapras', 'rara holo', 'água'],
    ['sv151', 3, 'venusaur ex', 'dupla rara', 'planta'],
    ['sv151', 6, 'charizard ex', 'dupla rara', 'fogo'],
    ['sv151', 25, 'pikachu', 'comum', 'elétrico'],
    ['sv151', 94, 'gengar', 'incomum', 'psíquico'],
    ['sv151', 150, 'mewtwo', 'rara', 'psíquico'],
    ['sv151', 151, 'mew ex', 'dupla rara', 'psíquico'],
  ] as const
).map(([set, n, name, rar, tipo]) => ({ id: `${set}-${n}`, set, n, name, rar, tipo }));

export const ITEMS: Item[] = [
  {
    id: 'i1',
    card: 'base1-4',
    variant: '1ª edição',
    lang: 'EN',
    price: 890,
    qty: 1,
    grade: { co: 'PSA', n: 8 },
    status: 'estoque',
    added: 2,
  },
  { id: 'i2', card: 'base1-2', variant: 'normal', lang: 'EN', price: 420, qty: 2, status: 'estoque', added: 6 },
  { id: 'i3', card: 'base1-10', variant: 'normal', lang: 'EN', price: 150, qty: 3, status: 'estoque', added: 9 },
  { id: 'i4', card: 'base1-58', variant: 'normal', lang: 'EN', price: 60, qty: 5, status: 'estoque', added: 12 },
  {
    id: 'i5',
    card: 'base1-15',
    variant: 'normal',
    lang: 'EN',
    price: 480,
    qty: 1,
    grade: { co: 'CGC', n: 8 },
    status: 'estoque',
    added: 4,
  },
  { id: 'i6', card: 'fossil-5', variant: 'normal', lang: 'EN', price: 85, qty: 2, status: 'estoque', added: 15 },
  { id: 'i7', card: 'jungle-11', variant: 'normal', lang: 'EN', price: 45, qty: 0, status: 'esgotado', added: 30 },
  { id: 'i8', card: 'sv151-6', variant: 'normal', lang: 'PT', price: 120, qty: 4, status: 'estoque', added: 1 },
  { id: 'i9', card: 'sv151-151', variant: 'holo', lang: 'PT', price: 65, qty: 10, status: 'prevenda', added: 0 },
  { id: 'i10', card: 'sv151-25', variant: 'reverse holo', lang: 'PT', price: 18, qty: 12, status: 'estoque', added: 3 },
  { id: 'i11', card: 'sv151-94', variant: 'holo', lang: 'EN', price: 25, qty: 6, status: 'estoque', added: 7 },
  { id: 'i12', card: 'sv151-6', variant: 'holo', lang: 'EN', price: 140, qty: 2, status: 'estoque', added: 5 },
];

// Stryker restore all
export const setById: Record<string, TcgSet> = Object.fromEntries(SETS.map((s) => [s.id, s]));
export const cardById: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/**
 * Imagem oficial da carta no CDN aberto do TCGdex (#16). Em português só quando o set existe em PT;
 * `low` (245×337) nas grades, `high` (600×825) na página da carta.
 */
export const cardImage = (c: Card, lang = 'EN', size: 'low' | 'high' = 'low'): string => {
  const set = setById[c.set];
  const l = lang === 'PT' && set.langs.includes('PT') ? 'pt' : 'en';
  return `https://assets.tcgdex.net/${l}/${set.tcgdex}/${String(c.n).padStart(set.pad, '0')}/${size}.webp`;
};

/** "charizard 4/102" */
export const itemName = (it: Item): string => {
  const c = cardById[it.card];
  return `${c.name} ${c.n}/${setById[c.set].total}`;
};

// Stryker disable all
export const PRODUCTS: Product[] = [
  { id: 'a1', kind: 'acc', name: 'porta-card rígido', price: 18, note: 'impresso em 3D' },
  { id: 'a2', kind: 'acc', name: 'deck box 60 cards', price: 54, note: 'impresso em 3D' },
  { id: 'a3', kind: 'acc', name: 'suporte de exibição', price: 16, note: 'impresso em 3D' },
  { id: 'a4', kind: 'acc', name: 'suporte para card gradado', price: 24, note: 'impresso em 3D' },
  // biome-ignore format: tabela
  { id: 'k1', kind: 'craft', name: 'organizador de dados', price: 42, spec: [['material', 'PLA'], ['medidas', '90 × 60 × 28 mm'], ['impressão', '~4 h']], note: '6 vãos' },
  // biome-ignore format: tabela
  { id: 'k2', kind: 'craft', name: 'torre de dados', price: 96, spec: [['material', 'PETG'], ['medidas', '80 × 80 × 160 mm'], ['impressão', '~11 h']], note: 'queda interna em rampa' },
  // biome-ignore format: tabela
  { id: 'k3', kind: 'craft', name: 'bandeja de dados com tampa', price: 78, spec: [['material', 'PLA'], ['medidas', '200 × 200 × 30 mm'], ['impressão', '~9 h']], note: 'tampa encaixa' },
  // biome-ignore format: tabela
  { id: 'k4', kind: 'craft', name: 'suporte para escudo de mestre', price: 38, spec: [['material', 'PLA'], ['medidas', '140 × 120 × 45 mm'], ['impressão', '~5 h']], note: 'rpg' },
  // biome-ignore format: tabela
  { id: 'k5', kind: 'craft', name: 'organizador de tokens', price: 52, spec: [['material', 'PLA'], ['medidas', '150 × 100 × 25 mm'], ['impressão', '~6 h']], note: '12 vãos' },
  // biome-ignore format: tabela
  { id: 'k6', kind: 'craft', name: 'gaveta modular de miniaturas', price: 64, spec: [['material', 'PLA'], ['medidas', '120 × 120 × 60 mm'], ['impressão', '~8 h']], note: 'empilhável' },
  // Stryker restore all
  ...VARIANTS.map(
    ([variant, color, rar], i): Mini => ({
      id: `m${i + 1}`,
      kind: 'mini',
      n: i + 1,
      name: `fiozinho ${variant}`,
      price: MINI_PRICE[rar],
      rar,
      color,
    }),
  ),
  ...ITEMS.map(
    (it): SaleItem => ({
      id: it.id,
      kind: 'item',
      name: itemName(it),
      price: it.price,
      qty: it.qty,
      status: it.status,
      lang: it.lang,
      variant: it.variant,
      grade: it.grade ?? null,
    }),
  ),
];

export const productById: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
export const MINIS = PRODUCTS.filter((p): p is Mini => p.kind === 'mini');

/** Linha de detalhe do produto no carrinho. */
export const productSubtitle = (p: Product): string => {
  if (p.kind === 'item')
    return `${p.lang} · ${p.variant}${p.grade ? ` · ${p.grade.co} ${p.grade.n}` : ''}${p.status === 'prevenda' ? ' · pré-venda' : ''}`;
  if (p.kind === 'mini') return `colecionável #${pad3(p.n)}`;
  return p.kind === 'craft' ? 'criar' : 'acessório';
};
