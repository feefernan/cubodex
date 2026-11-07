/** Coleção interna (#80): itens de um set, estado, progresso, filtros e séries. Sem DOM; a posse vem de /api/colecao. */
import type { TcgCardInfo, TcgSetInfo } from './enciclopedia';
import { normalize } from './format';

/** Posse por carta e variante: `${cardId}|${variant}` → quantidade (só entra quem tem). */
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
  qty: number;
}

/**
 * Modo simples: uma carta por quadrado, "tenho" se tiver qualquer variante (soma das quantidades); marcar vale para a
 * variante principal. Modo variantes: cada variante é um quadrado.
 */
export const tiles = (cards: TcgCardInfo[], own: Own, variantsOn: boolean): Tile[] =>
  cards.flatMap((card): Tile[] => {
    const all = variantsOf(card);
    if (variantsOn) return all.map((v) => ({ card, variant: v, variants: [v], qty: own[ownKey(card.id, v)] ?? 0 }));
    return [{ card, variant: null, variants: all, qty: all.reduce((n, v) => n + (own[ownKey(card.id, v)] ?? 0), 0) }];
  });

export type Status = 'falta' | 'tenho' | 'repetida';
export const statusOf = (qty: number): Status => (qty <= 0 ? 'falta' : qty === 1 ? 'tenho' : 'repetida');

export interface Progress {
  have: number;
  total: number;
  /** Inteiro, arredondado para baixo: 99,6% não vira 100% antes de completar. */
  pct: number;
  complete: boolean;
}

export const progress = (list: Tile[]): Progress => {
  const have = list.filter((t) => t.qty > 0).length;
  const total = list.length;
  return { have, total, pct: total ? Math.floor((have / total) * 100) : 0, complete: total > 0 && have === total };
};

/** Cartas fora das numeradas do set (secretas), pelos números da própria enciclopédia. */
export const secretCount = (set: Pick<TcgSetInfo, 'total' | 'official'>): number =>
  Math.max(set.total - set.official, 0);

export type Tab = 'todas' | 'tenho' | 'preciso';

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
  /** Logo do set mais novo da série que tem logo; null se nenhum tiver. */
  logo: string | null;
}

/** Séries na ordem do primeiro set de cada uma (a API manda do mais novo ao mais antigo); os sets de cada série, do mais novo ao mais antigo. */
export const groupSeries = (sets: TcgSetInfo[]): SerieGroup[] => {
  const groups = new Map<string, SerieGroup>();
  for (const set of sets) {
    const id = set.serie_id || 'outros';
    const group = groups.get(id) ?? { id, name: set.serie || 'outros', sets: [], logo: null };
    group.sets.push(set);
    groups.set(id, group);
  }
  return [...groups.values()].map((g) => {
    const sorted = [...g.sets].sort((a, b) => (b.released ?? '').localeCompare(a.released ?? ''));
    return { ...g, sets: sorted, logo: sorted.find((s) => s.logo)?.logo ?? null };
  });
};
