/**
 * Dados do TCGdex (tcgdex.net) no formato das tabelas tcg_sets e tcg_cards. Funções puras, sem imports: a Action
 * semanal (scripts/tcg-sync.ts) e os testes usam as mesmas.
 */

export interface SetRow {
  id: string;
  name: string;
  name_pt: string | null;
  serie_id: string;
  serie: string;
  released: string | null;
  total: number;
  official: number;
  logo: string | null;
  symbol: string | null;
}

export interface CardRow {
  id: string;
  set_id: string;
  local_id: string;
  num: number | null;
  name: string;
  name_pt: string | null;
  rarity: string | null;
  category: string | null;
  types: string | null;
  variants: string | null;
  image: string | null;
}

type Raw = Record<string, unknown>;
const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** `https://assets.tcgdex.net/en/sv/sv03.5/006` → `sv/sv03.5/006` (o idioma e a qualidade são escolhidos na hora de mostrar). */
export const imagePath = (url: unknown): string | null => {
  const m =
    typeof url === 'string'
      ? url.match(/^https:\/\/assets\.tcgdex\.net\/(?:[a-z]{2}|univ)\/([\w./-]+?)(?:\/(?:logo|symbol))?(?:\.\w+)?$/)
      : null;
  return m ? m[1] : null;
};

/** Um set vindo do GraphQL; `namePt` vem da lista de sets em português. */
export const setRow = (raw: Raw, namePt: string | null): SetRow | null => {
  const id = str(raw.id, 60);
  const name = str(raw.name);
  if (!id || !name || !/^[\w.-]+$/.test(id)) return null;
  const serie = (raw.serie ?? {}) as Raw;
  const count = (raw.cardCount ?? {}) as Raw;
  return {
    id,
    name,
    name_pt: namePt,
    serie_id: str(serie.id, 60) ?? '',
    serie: str(serie.name) ?? '',
    released: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.releaseDate)) ? String(raw.releaseDate) : null,
    total: int(count.total),
    official: int(count.official),
    logo: imagePath(raw.logo),
    symbol: imagePath(raw.symbol),
  };
};

/** Uma carta do GraphQL; `namePt` vem do set em português (mesmo id). Cartas de outro set (o filtro é por trecho do id) saem. */
export const cardRow = (raw: Raw, setId: string, namePt: string | null): CardRow | null => {
  const id = str(raw.id, 80);
  const localId = str(raw.localId, 30);
  const name = str(raw.name);
  if (!id || !localId || !name || ((raw.set ?? {}) as Raw).id !== setId) return null;
  const variants = (raw.variants ?? {}) as Raw;
  const have = ['normal', 'reverse', 'holo', 'firstEdition'].filter((k) => variants[k] === true);
  const types = (Array.isArray(raw.types) ? raw.types : []).filter((t): t is string => typeof t === 'string');
  return {
    id,
    set_id: setId,
    local_id: localId,
    num: /^\d+$/.test(localId) ? Number(localId) : null,
    name,
    name_pt: namePt && namePt !== name ? namePt : null,
    rarity: str(raw.rarity, 60),
    category: str(raw.category, 40),
    types: types.length ? types.join(',') : null,
    variants: have.length ? have.join(',') : null,
    image: imagePath(raw.image),
  };
};

/** Hash curto do conteúdo (FNV-1a de 32 bits, em hexadecimal): só serve para saber se a linha mudou. */
export const rowHash = (row: object): string => {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(Object.values(row))) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

/** O que precisa gravar: linhas novas ou com hash diferente do que já está no banco. */
export const changed = <T extends { id: string }>(rows: T[], stored: Map<string, string>): (T & { h: string })[] =>
  rows.map((r) => ({ ...r, h: rowHash(r) })).filter((r) => stored.get(r.id) !== r.h);

export const SET_COLUMNS = [
  'id',
  'name',
  'name_pt',
  'serie_id',
  'serie',
  'released',
  'total',
  'official',
  'logo',
  'symbol',
  'h',
] as const;
export const CARD_COLUMNS = [
  'id',
  'set_id',
  'local_id',
  'num',
  'name',
  'name_pt',
  'rarity',
  'category',
  'types',
  'variants',
  'image',
  'h',
] as const;

/** `INSERT … ON CONFLICT DO UPDATE` de uma tabela, com um `?` por coluna (a Action manda os valores como parâmetros). */
export const upsertSql = (table: string, columns: readonly string[]): string =>
  `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${columns
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}`;
