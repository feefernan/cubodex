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
  /** "pack": produto lacrado do TCG (booster, caixa). Sem isso é acessório. */
  group?: 'pack';
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

/**
 * A carta do TCGdex que um item vende, com o que a loja mostra dela. Vem pronta da API (o Worker junta a linha do
 * Notion com a enciclopédia do D1); o catálogo de exemplo traz a sua.
 */
export interface CardRef {
  /** Id no TCGdex, ex.: `base1-4`. */
  id: string;
  setId: string;
  setName: string;
  /** Número impresso na carta (`4`, `006`) e total oficial do set. */
  number: string;
  total: number;
  name: string;
  rarity: string;
  /** Tipos do TCGdex, separados por vírgula (`Fire,Water`). */
  types: string;
  /** Caminho no CDN do TCGdex (`base/base1/4`); nulo se a carta não tem imagem. */
  image: string | null;
  /** O set existe em português: só então há imagem em português para uma carta PT. */
  pt: boolean;
}
export interface Item {
  id: string;
  photos?: string[];
  card: CardRef;
  variant: string;
  lang: string;
  price: number;
  qty: number;
  grade?: Grade;
  status: StockStatus;
  /** Quanto menor, mais recente (ordena "mais recentes"). */
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

/**
 * Pacote de miniaturas: o preço é a soma das 3 escolhidas menos o desconto da linha `pack` do Notion (Tipo "pacote").
 * Sem a linha no Notion o pacote não se vende; sem API (desenvolvimento), vale o desconto padrão.
 */
export const DEFAULT_PACK_DISCOUNT = 10;
export const PACK = { discount: DEFAULT_PACK_DISCOUNT, listed: true };

export const packPrice = (ids: string[]): number => {
  const sum = ids.reduce((a, id) => a + (productById[id]?.price ?? 0), 0);
  return Math.round(sum * (100 - PACK.discount)) / 100;
};
// shortcut: data do lançamento da série 01 ainda não definida (#15); vazio = "em breve". Formato: '2026-11-14T12:00:00-03:00'.
export const LAUNCH_DATE = '';

export const SERIES = [
  { id: 's1', label: 'série 01', name: 'fiozinho', open: true },
  { id: 's2', label: 'série 02', name: 'em breve', open: false },
];

// Cartas do catálogo de exemplo (desenvolvimento sem API). Em produção as cartas vêm do Notion + TCGdex.
const demoCard = (
  id: string,
  name: string,
  rarity: string,
  types: string,
  set: [string, string, number, boolean],
): CardRef => {
  const [setId, setName, total, pt] = set;
  const number = id.slice(setId.length + 1);
  const folder = setId.startsWith('base') ? 'base' : 'sv';
  return { id, setId, setName, number, total, name, rarity, types, image: `${folder}/${setId}/${number}`, pt };
};
const BASE1: [string, string, number, boolean] = ['base1', 'Base Set', 102, false];
const BASE2: [string, string, number, boolean] = ['base2', 'Jungle', 64, false];
const BASE3: [string, string, number, boolean] = ['base3', 'Fossil', 62, false];
const S151: [string, string, number, boolean] = ['sv03.5', '151', 165, true];

export const ITEMS: Item[] = [
  {
    id: 'i1',
    card: demoCard('base1-4', 'Charizard', 'Rare', 'Fire', BASE1),
    variant: '1ª edição',
    lang: 'EN',
    price: 890,
    qty: 1,
    grade: { co: 'PSA', n: 8 },
    status: 'estoque',
    added: 2,
  },
  {
    id: 'i2',
    card: demoCard('base1-2', 'Blastoise', 'Rare', 'Water', BASE1),
    variant: 'normal',
    lang: 'EN',
    price: 420,
    qty: 2,
    status: 'estoque',
    added: 6,
  },
  {
    id: 'i3',
    card: demoCard('base1-10', 'Mewtwo', 'Rare', 'Psychic', BASE1),
    variant: 'normal',
    lang: 'EN',
    price: 150,
    qty: 3,
    status: 'estoque',
    added: 9,
  },
  {
    id: 'i4',
    card: demoCard('base1-58', 'Pikachu', 'Common', 'Lightning', BASE1),
    variant: 'normal',
    lang: 'EN',
    price: 60,
    qty: 5,
    status: 'estoque',
    added: 12,
  },
  {
    id: 'i5',
    card: demoCard('base1-15', 'Venusaur', 'Rare', 'Grass', BASE1),
    variant: 'normal',
    lang: 'EN',
    price: 480,
    qty: 1,
    grade: { co: 'CGC', n: 8 },
    status: 'estoque',
    added: 4,
  },
  {
    id: 'i6',
    card: demoCard('base3-5', 'Gengar', 'Rare', 'Psychic', BASE3),
    variant: 'normal',
    lang: 'EN',
    price: 85,
    qty: 2,
    status: 'estoque',
    added: 15,
  },
  {
    id: 'i7',
    card: demoCard('base2-11', 'Snorlax', 'Rare', 'Colorless', BASE2),
    variant: 'normal',
    lang: 'EN',
    price: 45,
    qty: 0,
    status: 'esgotado',
    added: 30,
  },
  {
    id: 'i8',
    card: demoCard('sv03.5-006', 'Charizard ex', 'Double rare', 'Fire', S151),
    variant: 'normal',
    lang: 'PT',
    price: 120,
    qty: 4,
    status: 'estoque',
    added: 1,
  },
  {
    id: 'i9',
    card: demoCard('sv03.5-151', 'Mew ex', 'Double rare', 'Psychic', S151),
    variant: 'holo',
    lang: 'PT',
    price: 65,
    qty: 10,
    status: 'prevenda',
    added: 0,
  },
  {
    id: 'i10',
    card: demoCard('sv03.5-025', 'Pikachu', 'Common', 'Lightning', S151),
    variant: 'reverse holo',
    lang: 'PT',
    price: 18,
    qty: 12,
    status: 'estoque',
    added: 3,
  },
  {
    id: 'i11',
    card: demoCard('sv03.5-094', 'Gengar', 'Uncommon', 'Psychic', S151),
    variant: 'holo',
    lang: 'EN',
    price: 25,
    qty: 6,
    status: 'estoque',
    added: 7,
  },
  {
    id: 'i12',
    card: demoCard('sv03.5-006', 'Charizard ex', 'Double rare', 'Fire', S151),
    variant: 'holo',
    lang: 'EN',
    price: 140,
    qty: 2,
    status: 'estoque',
    added: 5,
  },
];

// Stryker restore all
/** Nome da carta à venda: o do TCGdex e o número sobre o total do set (`Charizard 4/102`). */
export const itemName = (it: Item): string => `${it.card.name} ${it.card.number}/${it.card.total}`;

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

/** Produtos à venda de um tipo, na ordem do catálogo (limite opcional): vitrines e destaques saem daqui. */
export const listedOf = (kind: Product['kind'], limit = Infinity): Product[] =>
  PRODUCTS.filter((p) => p.kind === kind && isListed(p)).slice(0, limit);

/**
 * O que o Notion descreve de um produto que não é carta (as cartas ainda vêm do código): vem do Notion pelo cron,
 * passa pelo D1 e chega ao navegador, então é sempre revalidado (`parseDef`) antes de entrar no catálogo.
 */
export interface ItemDef {
  kind: 'item';
  card: CardRef;
  lang: string;
  variant: string;
  grade: Grade | null;
  /** Quando a linha foi criada no Notion (ISO): quanto mais nova, mais "recente". */
  created: string | null;
}
export type ProductDef =
  | { kind: 'mini'; name: string; n: number; rar: Rarity; color: string }
  | { kind: 'craft'; name: string; spec: [string, string][]; note: string }
  | { kind: 'acc'; name: string; note: string; group?: 'pack' }
  | { kind: 'pack'; discount: number }
  | ItemDef;

/** A carta como o Notion a descreve, antes de o Worker juntá-la à enciclopédia: só o id do TCGdex. */
export interface ItemSpec extends Omit<ItemDef, 'card'> {
  tcgdex: string;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const RARITIES: Rarity[] = ['comum', 'rara', 'especial'];

const CARD_ID = /^[\w.-]{1,60}$/;
// Caminho no CDN do TCGdex: segmentos de letras, números, ponto e hífen; sem `..` nem barra inicial.
const IMAGE_PATH = /^(?!.*\.\.)\w[\w./-]{0,79}$/;

/** "PSA 8" → { co: 'PSA', n: 8 }; aceita objeto já pronto (vindo da API) e recusa o resto. */
const parseGrade = (v: unknown): Grade | null => {
  const text = typeof v === 'string' ? v.trim().match(/^([A-Za-z]{2,10})\s*(\d{1,2}(?:[.,]\d)?)$/) : null;
  const o = (v ?? {}) as Record<string, unknown>;
  const co = text ? text[1].toUpperCase() : str(o.co, 10);
  const n = text ? Number(text[2].replace(',', '.')) : Number(o.n);
  return co && Number.isFinite(n) && n > 0 && n <= 10 ? { co, n } : null;
};

/** O que vale para qualquer carta à venda: idioma, variante, gradação e data de criação. */
const itemFields = (o: Record<string, unknown>) => ({
  lang: o.lang === 'PT' ? 'PT' : 'EN',
  variant: str(o.variant, 40) || 'normal',
  grade: parseGrade(o.grade),
  created: typeof o.created === 'string' && !Number.isNaN(Date.parse(o.created)) ? o.created : null,
});

export const parseItemSpec = (v: unknown): ItemSpec | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  const tcgdex = str(o.tcgdex, 60);
  return o.kind === 'item' && tcgdex && CARD_ID.test(tcgdex) ? { kind: 'item', tcgdex, ...itemFields(o) } : null;
};

export const parseCardRef = (v: unknown): CardRef | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  const id = str(o.id, 60);
  const setId = str(o.setId, 60);
  const name = str(o.name, 120);
  const number = str(o.number, 12);
  const image = str(o.image, 80);
  const total = Number(o.total);
  return id &&
    setId &&
    name &&
    number &&
    CARD_ID.test(id) &&
    CARD_ID.test(setId) &&
    Number.isInteger(total) &&
    total >= 0
    ? {
        id,
        setId,
        setName: str(o.setName, 120) || setId,
        number,
        total,
        name,
        rarity: str(o.rarity, 60),
        types: str(o.types, 80),
        image: image && IMAGE_PATH.test(image) ? image : null,
        pt: o.pt === true,
      }
    : null;
};

export const parseDef = (v: unknown): ProductDef | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  const name = str(o.name, 120);
  switch (o.kind) {
    case 'mini': {
      const n = Number(o.n);
      const color = str(o.color, 7);
      const rar = RARITIES.find((r) => r === o.rar);
      return name && rar && Number.isInteger(n) && n > 0 && /^#[0-9a-fA-F]{6}$/.test(color)
        ? { kind: 'mini', name, n, rar, color }
        : null;
    }
    case 'craft': {
      const spec = (Array.isArray(o.spec) ? o.spec : []).flatMap((e): [string, string][] => {
        const [k, val] = Array.isArray(e) ? e : [];
        return str(k, 30) && str(val, 60) ? [[str(k, 30), str(val, 60)]] : [];
      });
      return name ? { kind: 'craft', name, spec, note: str(o.note, 120) } : null;
    }
    case 'acc':
      return name
        ? { kind: 'acc', name, note: str(o.note, 120), ...(o.group === 'pack' ? { group: 'pack' } : {}) }
        : null;
    case 'item': {
      const card = parseCardRef(o.card);
      return card ? { kind: 'item', card, ...itemFields(o) } : null;
    }
    case 'pack': {
      const discount = Number(o.discount);
      return Number.isFinite(discount) && discount >= 0 && discount <= 90 ? { kind: 'pack', discount } : null;
    }
    default:
      return null;
  }
};

/**
 * Cria ou atualiza no catálogo um produto vindo do Notion. Produto novo sem preço não vende (começa fora de venda).
 * Mantém as listas (`PRODUCTS`, `productById`, `MINIS`) como estão, só mudando o conteúdo: quem as importou continua certo.
 */
export const defineProduct = (
  id: string,
  def: Exclude<ProductDef, { kind: 'pack' | 'item' }>,
  price: number | null,
) => {
  const old = productById[id];
  const base = { id, name: def.name, price: price !== null && price >= 0 ? price : (old?.price ?? 0) };
  const next: Product =
    def.kind === 'mini'
      ? { ...base, kind: 'mini', n: def.n, rar: def.rar, color: def.color }
      : def.kind === 'craft'
        ? { ...base, kind: 'craft', spec: def.spec, note: def.note }
        : { ...base, kind: 'acc', note: def.note, ...(def.group ? { group: def.group } : {}) };
  if (old) PRODUCTS[PRODUCTS.indexOf(old)] = next;
  else PRODUCTS.push(next);
  productById[id] = next;
  MINIS.length = 0;
  MINIS.push(...PRODUCTS.filter((p): p is Mini => p.kind === 'mini').sort((a, b) => a.n - b.n));
  return next;
};

/**
 * Cria ou atualiza uma carta à venda vinda do Notion. O item (para as telas) e o produto (para o carrinho e o
 * servidor) andam juntos: o estoque e o status são os que já estavam, ou "esgotado" até o Notion dizer o contrário.
 */
export const defineItem = (id: string, def: ItemDef, price: number | null) => {
  const old = ITEMS.find((it) => it.id === id);
  const oldProduct = productById[id];
  const value = price !== null && price >= 0 ? price : (old?.price ?? 0);
  const item: Item = {
    id,
    card: def.card,
    variant: def.variant,
    lang: def.lang,
    price: value,
    qty: old?.qty ?? 0,
    ...(def.grade && { grade: def.grade }),
    status: old?.status ?? 'esgotado',
    added: def.created ? -Date.parse(def.created) : (old?.added ?? 0),
    ...(old?.photos && { photos: old.photos }),
  };
  if (old) ITEMS[ITEMS.indexOf(old)] = item;
  else ITEMS.push(item);
  const product: Product = {
    id,
    kind: 'item',
    name: itemName(item),
    price: value,
    qty: item.qty,
    status: item.status,
    lang: item.lang,
    variant: item.variant,
    grade: def.grade,
    ...(oldProduct?.listed !== undefined && { listed: oldProduct.listed }),
    ...(oldProduct?.photos && { photos: oldProduct.photos }),
  };
  if (oldProduct) PRODUCTS[PRODUCTS.indexOf(oldProduct)] = product;
  else PRODUCTS.push(product);
  productById[id] = product;
};

/** Linha de detalhe do produto no carrinho. */
export const productSubtitle = (p: Product): string => {
  if (p.kind === 'item')
    return `${p.lang} · ${p.variant}${p.grade ? ` · ${p.grade.co} ${p.grade.n}` : ''}${p.status === 'prevenda' ? ' · pré-venda' : ''}`;
  if (p.kind === 'mini') return `colecionável #${pad3(p.n)}`;
  return p.kind === 'craft' ? 'criar' : 'acessório';
};
