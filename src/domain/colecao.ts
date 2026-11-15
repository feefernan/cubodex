/** Coleção interna (#80): itens de um set, estado, progresso, filtros e séries. Sem DOM; a posse vem de /api/colecao. */
import type { TcgCardInfo, TcgSetInfo } from './enciclopedia';
import { normalize } from './format';

/** Posse por carta e variante: `${cardId}|${variant}` → quantidade (só entra quem tem). */
/** Máximo de unidades de uma carta e variante, na coleção e no estoque da loja. */
export const MAX_QTY = 999;

export type Own = Record<string, number>;

const CARD_ID = /^[\w.!%-]{1,80}$/;
/** Ordem em que a variante "principal" é escolhida; o que o TCGdex trouxer fora da lista vai depois. */
const VARIANT_ORDER = ['normal', 'reverse', 'holo', 'firstEdition'];

export const ownKey = (cardId: string, variant: string) => `${cardId}|${variant}`;

/** `[cartaId, variante, qtd]` da API → mapa. Descarta o que não tem o formato esperado (a resposta passa pelo navegador). */
export const parseOwn = (items: unknown): Own => {
  const own: Own = {};
  if (!Array.isArray(items)) return own;
  for (const row of items) {
    if (!Array.isArray(row)) continue;
    const [id, variant, qty] = row;
    if (
      typeof id === 'string' &&
      CARD_ID.test(id) &&
      typeof variant === 'string' &&
      variant &&
      Number.isInteger(qty) &&
      qty > 0
    )
      own[ownKey(id, variant)] = qty;
  }
  return own;
};

/** Set de uma carta pelo id do TCGdex (`sv03.5-006` → `sv03.5`): o id é o do set, hífen e o número da carta. */
export const setOfCard = (cardId: string): string => {
  const cut = cardId.lastIndexOf('-');
  return cut > 0 ? cardId.slice(0, cut) : cardId;
};

/** Quantas cartas diferentes (não variantes) temos de cada set. */
export const ownedBySet = (own: Own): Map<string, number> => {
  const cards = new Map<string, Set<string>>();
  for (const key of Object.keys(own)) {
    const card = key.slice(0, key.lastIndexOf('|'));
    const set = setOfCard(card);
    cards.set(set, (cards.get(set) ?? new Set()).add(card));
  }
  return new Map([...cards].map(([set, ids]) => [set, ids.size]));
};

/** "2023-09-22" → "22/09/2023"; sem data válida, vazio. */
export const releaseLabel = (released: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(released ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Variantes da carta, na ordem de VARIANT_ORDER; sem informação do TCGdex vale uma só: normal. */
export const variantsOf = (card: Pick<TcgCardInfo, 'variants'>): string[] => {
  const list = (card.variants ?? '').split(',').filter(Boolean);
  if (!list.length) return ['normal'];
  const rank = (v: string) => (VARIANT_ORDER.includes(v) ? VARIANT_ORDER.indexOf(v) : VARIANT_ORDER.length);
  return [...list].sort((a, b) => rank(a) - rank(b));
};

export const primaryVariant = (card: Pick<TcgCardInfo, 'variants'>): string => variantsOf(card)[0] ?? 'normal';

/** Um quadrado da grade: a carta toda (variant null) ou uma variante dela. */
export interface Tile {
  card: TcgCardInfo;
  variant: string | null;
  /** Variantes que o quadrado cobre: todas no modo simples, só a sua no modo variantes. */
  variants: string[];
  /** Total que temos: coleção + estoque da loja. */
  qty: number;
  /** Só a parte da coleção: é o que marcar, desmarcar e o seletor mexem. */
  col: number;
}

/**
 * Modo simples: uma carta por quadrado, "tenho" se tiver qualquer variante (soma das quantidades); marcar vale para a
 * variante principal. Modo variantes: cada variante é um quadrado. O estoque da loja soma ao total (`qty`), nunca à
 * coleção (`col`): quem tem a carta só no estoque aparece como "tenho", e a coleção continua desmarcada.
 */
export const tiles = (cards: TcgCardInfo[], own: Own, variantsOn: boolean, stock: StockItem[] = []): Tile[] => {
  const shop = (cardId: string, variant: string | null) => shopCount(stock, cardId, variant);
  return cards.flatMap((card): Tile[] => {
    const all = variantsOf(card);
    const tile = (variant: string | null, variants: string[]): Tile => {
      const col = variants.reduce((n, v) => n + (own[ownKey(card.id, v)] ?? 0), 0);
      return { card, variant, variants, col, qty: col + shop(card.id, variant) };
    };
    return variantsOn ? all.map((v) => tile(v, [v])) : [tile(null, all)];
  });
};

/** Unidades da carta à venda na loja (de uma variante, ou de todas se `variant` é null); sem controle de estoque vale 1. */
export const shopCount = (stock: StockItem[], cardId: string, variant: string | null): number =>
  stock
    .filter((s) => s.cardId === cardId && (variant === null || s.variant === variant))
    .reduce((n, s) => n + (s.available ?? 1), 0);

/** Posse com uma variante a mais ou a menos; quantidade 0 tira a entrada. Não altera o mapa recebido. */
export const withQty = (own: Own, cardId: string, variant: string, qty: number): Own => {
  const next = { ...own };
  if (qty > 0) next[ownKey(cardId, variant)] = qty;
  else delete next[ownKey(cardId, variant)];
  return next;
};

/**
 * Pares [carta, variante] de "selecionar todas" (`on`) ou "desmarcar todas". Marcar toca no que falta na coleção (a
 * variante do quadrado, ou a principal no modo simples), mesmo que o estoque da loja já cubra a carta; desmarcar limpa
 * todas as variantes que o quadrado cobre.
 */
export const bulkPairs = (list: Tile[], on: boolean): [string, string][] =>
  list.flatMap((t): [string, string][] => {
    if (on) return t.col > 0 ? [] : [[t.card.id, t.variant ?? primaryVariant(t.card)]];
    return t.col > 0 ? t.variants.map((v): [string, string] => [t.card.id, v]) : [];
  });

export type Status = 'falta' | 'tenho' | 'repetida';
export const statusOf = (qty: number): Status => (qty <= 0 ? 'falta' : qty === 1 ? 'tenho' : 'repetida');

/** Inteiro, arredondado para baixo: 99,6% não vira 100% antes de completar. */
export const percent = (have: number, total: number): number => (total ? Math.floor((have / total) * 100) : 0);

export interface Progress {
  have: number;
  total: number;
  pct: number;
  complete: boolean;
}

export const progress = (list: Tile[]): Progress => {
  const have = list.filter((t) => t.qty > 0).length;
  const total = list.length;
  return { have, total, pct: percent(have, total), complete: total > 0 && have === total };
};

/** Cartas fora das numeradas do set (secretas), pelos números da própria enciclopédia. */
export const secretCount = (set: Pick<TcgSetInfo, 'total' | 'official'>): number =>
  Math.max(set.total - set.official, 0);

export type Tab = 'todas' | 'tenho' | 'preciso';

/** Uma carta à venda no estoque do Notion, como /api/colecao/estoque devolve. */
export interface StockItem {
  id: string;
  cardId: string;
  lang: string;
  variant: string;
  /** "PSA 8"; vazio = sem gradação. */
  grade: string;
  price: number | null;
  available: number | null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Só aceita o formato esperado (a resposta passa pelo navegador antes de virar HTML). */
export const parseStockItems = (data: unknown): StockItem[] => {
  const list = (data as { stock?: unknown } | null)?.stock;
  if (!Array.isArray(list)) return [];
  return list.flatMap((v): StockItem[] => {
    const o = (v ?? {}) as Record<string, unknown>;
    const id = text(o.id, 80);
    const cardId = text(o.cardId, 80);
    if (!id || !CARD_ID.test(cardId)) return [];
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);
    return [
      {
        id,
        cardId,
        lang: text(o.lang, 4),
        variant: text(o.variant, 30),
        grade: text(o.grade, 20),
        price: num(o.price),
        available: num(o.available),
      },
    ];
  });
};

/** Uma carta à venda no estoque da loja (Notion), listada na aba "Para trocar". */
export interface TradeRow {
  /** Id do produto no Notion/D1. */
  id: string;
  card: TcgCardInfo;
  variant: string;
  /** Unidades disponíveis, ou null se o Notion não controla. */
  qty: number | null;
  lang: string;
  grade: string;
  price: number | null;
}

/** Busca da aba "Para trocar": nome em inglês ou português, ou número da carta. */
export const filterTrade = (rows: TradeRow[], query: string): TradeRow[] => {
  const q = normalize(query.trim());
  return q
    ? rows.filter((r) => normalize(`${r.card.name} ${r.card.name_pt ?? ''} ${r.card.local_id}`).includes(q))
    : rows;
};

/** O estoque da loja neste set, na ordem das cartas. */
export const tradeRows = (cards: TcgCardInfo[], stock: StockItem[]): TradeRow[] =>
  cards.flatMap((card) =>
    stock
      .filter((s) => s.cardId === card.id)
      .map(
        (s): TradeRow => ({
          id: s.id,
          card,
          variant: s.variant,
          qty: s.available,
          lang: s.lang,
          grade: s.grade,
          price: s.price,
        }),
      ),
  );

/** Filtro da aba e da busca (nome em inglês ou português, ou o número da carta). */
export const filterTiles = (list: Tile[], tab: Tab, query: string): Tile[] => {
  const q = normalize(query.trim());
  return list.filter((t) => {
    if (tab === 'tenho' && t.qty <= 0) return false;
    if (tab === 'preciso' && t.qty > 0) return false;
    return !q || normalize(`${t.card.name} ${t.card.name_pt ?? ''} ${t.card.local_id}`).includes(q);
  });
};

/** Cor de fundo e do texto de cada série (cor de conteúdo, como a capa da série). Série fora da tabela usa o cinza do tema. */
const SERIE_COLORS: Record<string, { bg: string; fg: string }> = {
  me: { bg: '#7ED321', fg: '#101419' },
  sv: { bg: '#A62F87', fg: '#FFFFFF' },
  swsh: { bg: '#FF3FA4', fg: '#101419' },
  sm: { bg: '#F5A623', fg: '#101419' },
  xy: { bg: '#D6202B', fg: '#FFFFFF' },
  bw: { bg: '#3A3F47', fg: '#FFFFFF' },
  hgss: { bg: '#E0A82E', fg: '#101419' },
  pl: { bg: '#5C6B7A', fg: '#FFFFFF' },
  dp: { bg: '#5B9BD5', fg: '#101419' },
  ex: { bg: '#2E9E8F', fg: '#101419' },
  ecard: { bg: '#4A90D9', fg: '#101419' },
  neo: { bg: '#2F7D4F', fg: '#FFFFFF' },
  gym: { bg: '#B8481F', fg: '#FFFFFF' },
  base: { bg: '#F2C230', fg: '#101419' },
  tcgp: { bg: '#38BDF8', fg: '#101419' },
};

export const serieColor = (serieId: string): { bg: string; fg: string } | null => SERIE_COLORS[serieId] ?? null;

export interface SerieGroup {
  id: string;
  name: string;
  sets: TcgSetInfo[];
}

/** Séries na ordem do primeiro set de cada uma (a API manda do mais novo ao mais antigo); os sets de cada série, do mais novo ao mais antigo. */
export const groupSeries = (sets: TcgSetInfo[]): SerieGroup[] => {
  const groups = new Map<string, SerieGroup>();
  for (const set of sets) {
    const id = set.serie_id || 'outros';
    const group = groups.get(id) ?? { id, name: set.serie || 'outros', sets: [] };
    group.sets.push(set);
    groups.set(id, group);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    sets: [...g.sets].sort((a, b) => (b.released ?? '').localeCompare(a.released ?? '')),
  }));
};

/**
 * Busca da landing: séries pelo nome e coleções (sets) pelo nome em inglês ou português ou pelo código do set.
 * Sem texto, vale tudo: todas as séries e nenhuma coleção avulsa.
 */
export const searchColecao = (groups: SerieGroup[], query: string): { series: SerieGroup[]; sets: TcgSetInfo[] } => {
  const q = normalize(query.trim());
  if (!q) return { series: groups, sets: [] };
  return {
    series: groups.filter((g) => normalize(g.name).includes(q)),
    sets: groups.flatMap((g) => g.sets).filter((s) => normalize(`${s.name} ${s.name_pt ?? ''} ${s.id}`).includes(q)),
  };
};

// ───────── valor estimado (#108) ─────────

export interface Rates {
  EUR: number;
  USD: number;
}

const positive = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);
const field = (o: unknown, key: string): unknown =>
  o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : null;

/** Chaves do TCGplayer no `pricing` do TCGdex, por variante. */
const TCGPLAYER_KEY: Record<string, string> = {
  normal: 'normal',
  holo: 'holofoil',
  reverse: 'reverse-holofoil',
  firstEdition: '1st-edition-holofoil',
};

/**
 * Preço de uma unidade na moeda de origem, a partir do `pricing` do TCGdex: tendência do Cardmarket (euro; a "holo" para
 * holo e reverse, quando existe) e, sem ela, o preço de mercado do TCGplayer (dólar). Sem nenhum dos dois: null.
 * shortcut: a 1ª edição usa a tendência normal, o TCGdex não separa; melhorar se uma carta dessas pesar no total.
 */
export const unitPrice = (pricing: unknown, variant: string): { cur: keyof Rates; value: number } | null => {
  const cm = field(pricing, 'cardmarket');
  const eur =
    (variant === 'holo' || variant === 'reverse' ? positive(field(cm, 'trend-holo')) : null) ??
    positive(field(cm, 'trend'));
  if (eur) return { cur: 'EUR', value: eur };
  const tp = field(field(pricing, 'tcgplayer'), TCGPLAYER_KEY[variant] ?? 'normal');
  const usd = positive(field(tp, 'marketPrice'));
  return usd ? { cur: 'USD', value: usd } : null;
};

/** Soma em reais de linhas `[pricing, variante, quantidade]`; `missing` conta as linhas sem preço. */
export const chunkValue = (rows: [unknown, string, number][], rates: Rates): { brl: number; missing: number } => {
  let brl = 0;
  let missing = 0;
  for (const [pricing, variant, qty] of rows) {
    const p = unitPrice(pricing, variant);
    if (p) brl += p.value * rates[p.cur] * qty;
    else missing++;
  }
  return { brl: Math.round(brl * 100) / 100, missing };
};
