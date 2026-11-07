/** Coleção interna (#80): landing de séries, coleções de cada série e (nas próximas fases) a página do set. */
import {
  groupSeries,
  ownedBySet,
  parseOwn,
  releaseLabel,
  type SerieGroup,
  searchColecao,
  serieColor,
} from '../domain/colecao';
import { logoUrl, parseSets, setTitle, type TcgSetInfo } from '../domain/enciclopedia';
import { escapeHtml as esc } from '../domain/format';
import { routeHref, type View } from '../domain/routes';
import { ApiError, api } from '../infra/api';
import { emptyState } from './art';
import { $, onAction, onInput } from './dom';
import { currentView, registerView } from './router';

interface Data {
  groups: SerieGroup[];
  owned: Map<string, number>;
}

/** Cada abertura de tela vale por uma só: resposta que chega depois de o usuário trocar de tela é descartada. */
let ticket = 0;

const load = async (): Promise<Data> => {
  const [sets, mine] = await Promise.all([api.tcgSets(), api.colecao()]);
  return { groups: groupSeries(parseSets(sets)), owned: ownedBySet(parseOwn(mine.items)) };
};

const pct = (have: number, total: number) => (total ? Math.floor((have / total) * 100) : 0);
const cards = (sets: TcgSetInfo[]) => sets.reduce((n, s) => n + s.total, 0);
const have = (sets: TcgSetInfo[], owned: Map<string, number>) => sets.reduce((n, s) => n + (owned.get(s.id) ?? 0), 0);

const skeleton = (n: number) =>
  `<div class="cx-skels" role="status"><span class="sr-only">carregando…</span>${'<div class="cx-skel" aria-hidden="true"></div>'.repeat(n)}</div>`;

const ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const HOME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>';
const THEME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>';

interface Crumb {
  label: string;
  view: View;
  id?: string;
}

/** Cabeçalho de app: voltar para o nível de cima, migalhas, início, tema e a volta à loja. */
const head = (crumbs: Crumb[]) => {
  const up = crumbs[crumbs.length - 2];
  const back = up
    ? `<a class="icon-link cx-back" href="${routeHref(up.view, up.id)}" data-action="go" data-view="${up.view}"${up.id ? ` data-id="${esc(up.id)}"` : ''} aria-label="Voltar para ${esc(up.label)}">${ARROW}</a>`
    : `<a class="icon-link cx-back" href="#/home" data-action="go" data-view="home" aria-label="Voltar à loja">${ARROW}</a>`;
  const trail = crumbs
    .map((c, i) =>
      i === crumbs.length - 1
        ? `<span aria-current="page">${esc(c.label)}</span>`
        : `<a href="${routeHref(c.view, c.id)}" data-action="go" data-view="${c.view}"${c.id ? ` data-id="${esc(c.id)}"` : ''}>${esc(c.label)}</a>`,
    )
    .join('<span class="cx-sep" aria-hidden="true">›</span>');
  $('#cxHead').innerHTML =
    `<div class="wrap cx-head-row">${back}<nav class="cx-crumbs" aria-label="Você está em">${trail}</nav>` +
    `<a class="icon-link" href="#/colecao" data-action="go" data-view="colecao" aria-label="Início da coleção">${HOME}</a>` +
    `<button class="icon-link" type="button" data-action="cx-theme" aria-label="Alternar modo claro e escuro">${THEME}</button>` +
    `<a class="icon-link cx-shop" href="#/home" data-action="go" data-view="home"><span class="lbl">voltar à loja</span></a></div>`;
};

const denied = (e: unknown) =>
  e instanceof ApiError && (e.status === 404 || e.status === 401)
    ? emptyState(
        'área restrita.',
        'A coleção é de uso interno. Entre com um e-mail autorizado na sua conta.',
        '<a class="btn btn--ghost btn--sm" href="#/conta" data-action="go" data-view="conta">ir para a conta</a>',
      )
    : emptyState(
        'não deu para abrir.',
        (e as Error).message,
        '<button class="btn btn--ghost btn--sm" data-action="cx-retry">tentar de novo</button>',
      );

/** Carrega os dados e desenha a tela; `draw` só roda se esta ainda é a tela aberta. */
const openView = async (body: string, crumbs: Crumb[], n: number, draw: (d: Data, el: HTMLElement) => void) => {
  const mine = ++ticket;
  head(crumbs);
  const el = $(body);
  el.innerHTML = skeleton(n);
  try {
    const data = await load();
    if (mine !== ticket) return;
    draw(data, el);
  } catch (e) {
    if (mine === ticket) el.innerHTML = denied(e);
  }
};

const ring = (value: number) =>
  `<span class="cx-ring" style="--p:${value}" role="img" aria-label="${value}% completa"><b class="num">${value}%</b></span>`;

const serieCard = (g: SerieGroup, owned: Map<string, number>) => {
  const color = serieColor(g.id);
  const mine = have(g.sets, owned);
  const total = cards(g.sets);
  const style = color ? ` style="--cx-bg:${color.bg};--cx-fg:${color.fg}"` : '';
  return (
    `<a class="cx-card" href="#/colserie/${esc(g.id)}" data-action="go" data-view="colserie" data-id="${esc(g.id)}"${style}>` +
    `<span class="cx-card-name display">${esc(g.name)}</span>` +
    `<span class="cx-card-meta mono">${g.sets.length} ${g.sets.length === 1 ? 'coleção' : 'coleções'} · ${mine}/${total} cartas</span>` +
    `<span class="cx-bar" role="img" aria-label="${pct(mine, total)}% completa"><i style="width:${pct(mine, total)}%"></i></span></a>`
  );
};

const setCard = (s: TcgSetInfo, owned: Map<string, number>) => {
  const mine = owned.get(s.id) ?? 0;
  const logo = s.logo
    ? `<img class="cx-set-logo" src="${logoUrl(s.logo)}" alt="" width="160" height="80" loading="lazy" decoding="async">`
    : `<span class="cx-set-logo cx-set-logo--text display">${esc(s.name)}</span>`;
  const date = releaseLabel(s.released);
  return (
    `<a class="cx-set" href="#/colset/${esc(s.id)}" data-action="go" data-view="colset" data-id="${esc(s.id)}">${logo}` +
    `<span class="cx-set-name">${esc(setTitle(s))}</span>` +
    `<span class="cx-set-foot"><span class="mono muted">${date ? `${date} · ` : ''}${mine}/${s.total} cartas</span>${ring(pct(mine, s.total))}</span></a>`
  );
};

/** Dados da landing já carregados: a busca refaz só a lista, sem ir ao servidor nem tirar o foco do campo. */
let landing: Data | null = null;

const drawLanding = () => {
  if (!landing) return;
  const { groups, owned } = landing;
  const { series, sets } = searchColecao(groups, $<HTMLInputElement>('#colecaoQ').value);
  const found =
    (series.length ? `<div class="cx-series">${series.map((g) => serieCard(g, owned)).join('')}</div>` : '') +
    (sets.length
      ? `<h2 class="cx-sub display">coleções encontradas</h2><div class="cx-sets">${sets.map((s) => setCard(s, owned)).join('')}</div>`
      : '');
  $('#colecaoBody').innerHTML =
    found ||
    (groups.length
      ? emptyState('nada encontrado.', 'Nenhuma série ou coleção com esse nome. Tente outra palavra.')
      : emptyState('nenhuma série.', 'A enciclopédia ainda não tem sets carregados.'));
};

const renderLanding = () => {
  landing = null;
  return openView('#colecaoBody', [{ label: 'séries', view: 'colecao' }], 6, (data) => {
    landing = data;
    const all = data.groups.flatMap((g) => g.sets);
    $('#colecaoSub').textContent = `${data.groups.length} séries · ${have(all, data.owned)}/${cards(all)} cartas`;
    drawLanding();
  });
};

const routeId = () =>
  location.hash
    .replace(/^#\/?/, '')
    .split('?')[0]
    ?.split('/')[1]
    ?.replace(/[^\w.-]/g, '') ?? '';

const renderSerie = () => {
  const id = routeId();
  return openView(
    '#colserieBody',
    [
      { label: 'séries', view: 'colecao' },
      { label: '…', view: 'colserie', id },
    ],
    6,
    ({ groups, owned }, el) => {
      const g = groups.find((x) => x.id === id);
      if (!g) {
        head([{ label: 'séries', view: 'colecao' }]);
        $('#colserieSub').textContent = '';
        el.innerHTML = emptyState(
          'série não encontrada.',
          'Essa série não existe na enciclopédia.',
          '<a class="btn btn--ghost btn--sm" href="#/colecao" data-action="go" data-view="colecao">ver as séries</a>',
        );
        return;
      }
      head([
        { label: 'séries', view: 'colecao' },
        { label: g.name, view: 'colserie', id },
      ]);
      $('#colserieSub').textContent = `${g.name} · ${have(g.sets, owned)}/${cards(g.sets)} cartas`;
      el.innerHTML = `<div class="cx-sets">${g.sets.map((s) => setCard(s, owned)).join('')}</div>`;
    },
  );
};

/** A página do set vem na próxima fase: por enquanto só mostra o set e leva de volta. */
const renderSet = () => {
  const id = routeId();
  return openView('#colsetBody', [{ label: 'séries', view: 'colecao' }], 1, ({ groups }, el) => {
    const g = groups.find((x) => x.sets.some((s) => s.id === id));
    const s = g?.sets.find((x) => x.id === id);
    if (!g || !s) {
      head([{ label: 'séries', view: 'colecao' }]);
      el.innerHTML = emptyState(
        'coleção não encontrada.',
        'Esse set não existe na enciclopédia.',
        '<a class="btn btn--ghost btn--sm" href="#/colecao" data-action="go" data-view="colecao">ver as séries</a>',
      );
      return;
    }
    head([
      { label: 'séries', view: 'colecao' },
      { label: g.name, view: 'colserie', id: g.id },
      { label: s.name, view: 'colset', id },
    ]);
    el.innerHTML = emptyState('em breve.', `${esc(setTitle(s))}: a página do set chega na próxima etapa.`);
  });
};

const RENDER: Partial<Record<View, () => Promise<void>>> = {
  colecao: renderLanding,
  colserie: renderSerie,
  colset: renderSet,
};

export const initColecao = () => {
  for (const [view, render] of Object.entries(RENDER) as [View, () => Promise<void>][])
    registerView(view, () => void render());
  onAction('cx-theme', () => $('#themeBtn').click());
  onInput('cx-search', drawLanding);
  onAction('cx-retry', () => void RENDER[currentView()]?.());
};
