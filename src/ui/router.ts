import { areaOf, isColView, isTcgView, isView, navGroup, subnavKey, type View } from '../domain/routes';
import { $, $$, onAction } from './dom';
import { S } from './store';

type Render = () => void;
const renders = new Map<View, Render>();
let current: View = 'home';

export const registerView = (v: View, render: Render) => renders.set(v, render);
export const refresh = () => renders.get(current)?.();

const TCG_NAV: [View, string][] = [
  ['tcg', 'cartas à venda'],
  ['acessorios', 'acessórios'],
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
        `<a href="#${v}" data-action="go" data-view="${v}"${extraClass(v)}${v === active ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');

const setCurrent = (el: Element, on: boolean) =>
  on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current');

interface GoOptions {
  tab?: string | null;
  id?: string | null;
  keepScroll?: boolean;
}

const go = (target: string, opt: GoOptions = {}) => {
  const v: View = isView(target) ? target : 'home';
  current = v;
  if (v === 'apoio' && opt.tab) S.apoio = opt.tab;
  if (v === 'carrinho') S.payNote = false;
  if (opt.id && v === 'set') S.setId = opt.id;
  if (opt.id && v === 'carta') S.cardId = opt.id;

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
  if (!opt.keepScroll) window.scrollTo(0, 0);
  // shortcut: replaceState não cria histórico (voltar sai do site) e não guarda o id — rotas de verdade em #8.
  try {
    history.replaceState(null, '', `#${v}`);
  } catch {
    /* sandbox sem history */
  }
};

export const initRouter = () => {
  onAction('go', (el) => go(el.dataset.view ?? 'home', { tab: el.dataset.tab, id: el.dataset.id }));
  onAction('scroll', (el) => {
    document.getElementById(el.dataset.target ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  const start = location.hash.replace('#', '');
  go(isView(start) ? start : 'home', { keepScroll: true });
};
