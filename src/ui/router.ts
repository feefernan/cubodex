import {
  areaOf,
  isColView,
  isTcgView,
  isView,
  navGroup,
  parseRoute,
  type Route,
  routeHref,
  subnavKey,
  type View,
} from '../domain/routes';
import { $, $$, onAction } from './dom';
import { S } from './store';

/** Título da página inicial: o mesmo do index.html, que é o que buscadores e prévias de link leem. */
const HOME_TITLE = 'Cubodex · cartas de pokémon, miniaturas e impressão 3D';

type Render = () => void;
const renders = new Map<View, Render>();
let current: View = 'home';

export const registerView = (v: View, render: Render) => renders.set(v, render);
export const refresh = () => renders.get(current)?.();
export const currentView = () => current;

const TCG_NAV: [View, string][] = [
  ['tcg', 'cartas à venda'],
  ['acessorios', 'lacrados e acessórios'],
  ['cofre', 'cofre virtual'],
  ['sets', 'enciclopédia de sets'],
];
const COL_NAV: [View, string][] = [
  ['colecionaveis', 'séries'],
  ['dex', 'dex'],
];

const navLinks = (items: [View, string][], active: string, extraClass: (v: View) => string = () => '') =>
  items
    .map(
      ([v, label]) =>
        `<a href="${routeHref(v)}" data-action="go" data-view="${v}"${extraClass(v)}${v === active ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');

const setCurrent = (el: Element, on: boolean) =>
  on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current');

/** Mostra a tela da rota: estado, menus, conteúdo. Não mexe na URL (quem muda a URL é `go`). */
const show = ({ view: v, id }: Route, focus: boolean) => {
  current = v;
  if (v === 'apoio' && id) S.apoio = id;
  if (id && v === 'set') S.setId = id;
  if (id && v === 'carta') S.cardId = id;
  if (id && v === 'pedido') S.orderSerial = id;

  for (const s of $$('.view')) s.hidden = s.id !== `v-${v}`;
  document.body.className = `a-${areaOf(v)}`;
  for (const a of $$('[data-nav]')) setCurrent(a, a.dataset.nav === navGroup(v));
  const sub = subnavKey(v);
  $('#subnav').hidden = sub === null;
  for (const a of $$('[data-sub]')) setCurrent(a, a.dataset.sub === sub);

  if (isTcgView(v)) {
    const k = v === 'set' ? 'sets' : v === 'carta' ? '' : v;
    const html = navLinks(TCG_NAV, k, (x) => (x === 'sets' ? ' class="enc"' : ''));
    for (const n of $$('.tcgnav')) n.innerHTML = html;
  }
  if (isColView(v)) {
    const html = navLinks(COL_NAV, v === 'serie' ? 'colecionaveis' : v);
    for (const n of $$('.colnav')) n.innerHTML = html;
  }
  renders.get(v)?.();

  const h1 = document.querySelector<HTMLElement>(`#v-${v} h1`);
  document.title = h1 && v !== 'home' ? `${h1.textContent?.replace(/\.$/, '')} · Cubodex` : HOME_TITLE;
  if (!focus) return;
  // Pula para o topo sem animar: rolar a página inteira a cada troca de tela seria movimento à toa.
  window.scrollTo({ top: 0, behavior: 'instant' });
  // Leitor de tela anuncia a tela nova; o foco não fica preso no link clicado (#11).
  if (h1) {
    h1.tabIndex = -1;
    h1.focus({ preventScroll: true });
  }
};

let shownHref = '';

const showHref = (href: string, focus: boolean) => {
  shownHref = href;
  show(parseRoute(href), focus);
};

/** Vai para uma tela: grava uma entrada no histórico (o voltar do navegador funciona) e mostra na hora. */
export const go = (target: string, id?: string | null) => {
  const href = routeHref(isView(target) ? target : 'home', id);
  if (href !== location.hash) history.pushState(null, '', href);
  showHref(href, true);
};

export const initRouter = () => {
  onAction('go', (el) => go(el.dataset.view ?? 'home', el.dataset.tab ?? el.dataset.id));
  onAction('scroll', (el) => {
    document.getElementById(el.dataset.target ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  // Voltar/avançar e URL editada à mão. Os dois eventos podem vir juntos: só desenha se a URL mudou.
  const onNavigate = () => {
    if (location.hash !== shownHref) showHref(location.hash, true);
  };
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);
  showHref(location.hash, false);
};
