import { FEATURES } from './features';

/** Ala visual de cada tela (troca raio e superfície via classe `a-*` no body). */
const AREA = {
  home: 'home',
  colecionar: 'home',
  tcg: 'tcg',
  acessorios: 'tcg',
  sets: 'tcg',
  set: 'tcg',
  carta: 'tcg',
  cofre: 'tcg',
  colecionaveis: 'col',
  serie: 'col',
  dex: 'col',
  criar: 'criar',
  conta: 'home',
  carrinho: 'home',
  apoio: 'home',
  pedido: 'home',
} as const;

export type View = keyof typeof AREA;

export const isView = (v: string): v is View => Object.hasOwn(AREA, v);
export const areaOf = (v: View) => AREA[v];

/** Item do menu principal aceso em cada tela. */
export const navGroup = (v: View): 'col' | 'criar' | undefined =>
  v === 'criar' ? 'criar' : AREA[v] === 'tcg' || AREA[v] === 'col' || v === 'colecionar' ? 'col' : undefined;

/** Item da subnavegação "colecionar" aceso; null = sem subnavegação nesta tela. */
export const subnavKey = (v: View): string | null => {
  if (v === 'colecionar') return 'colecionar';
  if (AREA[v] === 'tcg') return 'tcg';
  if (AREA[v] === 'col') return 'colecionaveis';
  return null;
};

export const isTcgView = (v: View) => AREA[v] === 'tcg';
export const isColView = (v: View) => AREA[v] === 'col';

export interface Route {
  view: View;
  /** Set, carta ou aba da ajuda, conforme a tela. */
  id: string | null;
}

/** Telas da parte de colecionáveis (e a página "colecionar" que leva a ela): com a seção desligada, levam ao TCG. */
const COLECIONAVEIS_VIEWS = new Set(['colecionar', 'colecionaveis', 'serie', 'dex']);
export const isHiddenView = (v: string) => !FEATURES.colecionaveis && COLECIONAVEIS_VIEWS.has(v);

/** `#/carta/base1-4` → { view: 'carta', id: 'base1-4' }. Aceita o formato antigo `#tcg`; tela desconhecida → home. */
export const parseRoute = (hash: string): Route => {
  // O Mercado Pago devolve `#/pedido/CBX-…?collection_id=…`: a query não faz parte do id.
  const [view = '', id = ''] = (hash.replace(/^#\/?/, '').split('?')[0] ?? '').split('/');
  // Ids são letras, números, hífen e ponto (sets do TCGdex como `sv03.5`): o resto é descartado (nada vindo da URL chega cru ao HTML).
  const clean = id.replace(/[^\w.-]/g, '');
  if (isHiddenView(view)) return { view: 'tcg', id: null };
  return isView(view) ? { view, id: clean || null } : { view: 'home', id: null };
};

export const routeHref = (view: View, id?: string | null): string => `#/${view}${id ? `/${id}` : ''}`;
