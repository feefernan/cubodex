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

/** `#/carta/base1-4` → { view: 'carta', id: 'base1-4' }. Aceita o formato antigo `#tcg`; tela desconhecida → home. */
export const parseRoute = (hash: string): Route => {
  const [view = '', id = ''] = hash.replace(/^#\/?/, '').split('/');
  // Ids são [a-z0-9-]: o resto é descartado (nada vindo da URL chega cru ao HTML).
  const clean = id.replace(/[^\w-]/g, '');
  return isView(view) ? { view, id: clean || null } : { view: 'home', id: null };
};

export const routeHref = (view: View, id?: string | null): string => `#/${view}${id ? `/${id}` : ''}`;
