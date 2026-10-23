/** Enciclopédia TCG no site: formatos da API, endereços de imagem no CDN do TCGdex, agrupamento, filtros e busca. */
import { normalize, uniq } from './format';

const CDN = 'https://assets.tcgdex.net';

export interface TcgSetInfo {
  id: string;
  name: string;
  name_pt: string | null;
  serie_id: string;
  serie: string;
  released: string | null;
  total: number;
  official: number;
  logo: string | null;
}

export interface TcgCardInfo {
  id: string;
  local_id: string;
  num: number | null;
  name: string;
  name_pt: string | null;
  rarity: string | null;
  types: string | null;
  variants: string | null;
  image: string | null;
}

/**
 * Carta no CDN: `low` (245×337) nas grades, `high` (600×825) na página da carta. A imagem em português só existe
 * nos sets que existem em português; fora deles, vale a em inglês.
 */
export const cardImageUrl = (path: string, size: 'low' | 'high' = 'low', lang: 'en' | 'pt' = 'en'): string =>
  `${CDN}/${lang}/${path}/${size}.webp`;
export const logoUrl = (path: string): string => `${CDN}/en/${path}/logo.webp`;

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Só aceita o que tem o formato esperado: a resposta passa pelo navegador antes de virar HTML. */
export const parseSet = (v: unknown): TcgSetInfo | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  const id = text(o.id);
  const name = text(o.name);
  return id && name
    ? {
        id,
        name,
        name_pt: text(o.name_pt),
        serie_id: text(o.serie_id) ?? '',
        serie: text(o.serie) ?? '',
        released: text(o.released),
        total: count(o.total),
        official: count(o.official),
        logo: text(o.logo),
      }
    : null;
};

export const parseCardInfo = (v: unknown): TcgCardInfo | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  const id = text(o.id);
  const name = text(o.name);
  const local = text(o.local_id);
  return id && name && local
    ? {
        id,
        local_id: local,
        num: typeof o.num === 'number' ? o.num : null,
        name,
        name_pt: text(o.name_pt),
        rarity: text(o.rarity),
        types: text(o.types),
        variants: text(o.variants),
        image: text(o.image),
      }
    : null;
};

export const parseSets = (data: unknown): TcgSetInfo[] =>
  ((data as { sets?: unknown })?.sets instanceof Array ? (data as { sets: unknown[] }).sets : []).flatMap(
    (s) => parseSet(s) ?? [],
  );

export const setYear = (s: TcgSetInfo): string => s.released?.slice(0, 4) ?? '';

/** Nome do set: o inglês, e o português ao lado quando for diferente. */
export const setTitle = (s: TcgSetInfo): string =>
  s.name_pt && s.name_pt !== s.name ? `${s.name} · ${s.name_pt}` : s.name;

/** "4/102": número da carta sobre o total oficial do set (cartas secretas passam do total, e seguem assim). */
export const numberLabel = (c: TcgCardInfo, s: TcgSetInfo): string =>
  s.official ? `${c.local_id}/${s.official}` : c.local_id;

/** Séries na ordem em que aparecem (a API manda do set mais novo ao mais antigo), cada uma com os seus sets. */
export const groupBySerie = (sets: TcgSetInfo[]): { serie: string; sets: TcgSetInfo[] }[] =>
  uniq(sets.map((s) => s.serie)).map((serie) => ({
    serie: serie || 'outros',
    sets: sets.filter((s) => s.serie === serie),
  }));

export const filterSetList = (sets: TcgSetInfo[], q: string, year: string): TcgSetInfo[] => {
  const nq = normalize(q.trim());
  return sets.filter(
    (s) => (!nq || normalize(`${s.name} ${s.name_pt ?? ''} ${s.serie}`).includes(nq)) && (!year || setYear(s) === year),
  );
};

/** Anos com set, do mais novo ao mais antigo. */
export const setYears = (sets: TcgSetInfo[]): string[] =>
  uniq(sets.map(setYear).filter(Boolean)).sort((a, b) => b.localeCompare(a));

/** Cartas de um set que passam pelo texto e pela raridade. */
export const filterCardList = (cards: TcgCardInfo[], q: string, rarity: string): TcgCardInfo[] => {
  const nq = normalize(q.trim());
  return cards.filter(
    (c) =>
      (!rarity || c.rarity === rarity) && (!nq || normalize(`${c.name} ${c.name_pt ?? ''} ${c.local_id}`).includes(nq)),
  );
};

/** Entrada do índice de busca: [id da carta, nome, nome em português ('' se não houver), id do set]. */
export type IndexEntry = [string, string, string, string];

export const parseIndex = (data: unknown): IndexEntry[] =>
  ((data as { cards?: unknown })?.cards instanceof Array ? (data as { cards: unknown[] }).cards : []).flatMap((e) =>
    Array.isArray(e) && e.length === 4 && e.every((x) => typeof x === 'string') ? [e as IndexEntry] : [],
  );

/** Busca por trecho do nome (inglês ou português), sem acento; quem começa pelo texto vem antes. */
export const searchIndex = (index: IndexEntry[], q: string, limit = 40): IndexEntry[] => {
  const nq = normalize(q.trim());
  if (nq.length < 2) return [];
  const starts: IndexEntry[] = [];
  const inside: IndexEntry[] = [];
  for (const e of index) {
    const names = [normalize(e[1]), normalize(e[2])];
    if (names.some((n) => n.startsWith(nq))) starts.push(e);
    else if (names.some((n) => n.includes(nq))) inside.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...inside].slice(0, limit);
};
