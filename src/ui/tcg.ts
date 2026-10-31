import { listedOf, photoUrl } from '../domain/catalog';
import {
  cardImageUrl,
  filterCardList,
  filterSetList,
  groupBySerie,
  type IndexEntry,
  logoUrl,
  numberLabel,
  parseCardInfo,
  parseIndex,
  parseSet,
  parseSets,
  searchIndex,
  setTitle,
  setYear,
  setYears,
  type TcgCardInfo,
  type TcgSetInfo,
} from '../domain/enciclopedia';
import { brl, escapeHtml as esc, uniq } from '../domain/format';
import {
  emptyFilters,
  type Filters,
  filterItems,
  filterOptions,
  itemsOfTcgdexCard,
  onSaleBySet,
  TYPE_PT,
  VARIANT_PT,
} from '../domain/tcg';
import { api } from '../infra/api';
import { emptyState } from './art';
import { alertMsg } from './cart';
import { $, $$, onAction, onInput } from './dom';
import { currentView, registerView } from './router';
import { S } from './store';
import { fillProducts, itemTile, saleRow } from './tiles';

/** Cartas mostradas de cada vez na página do set: as imagens vêm do CDN, e um set grande tem mais de 200. */
const PAGE = 60;

let F: Filters = emptyFilters();

const FIELDS: Record<Exclude<keyof Filters, 'graded' | 'stock'>, string> = {
  q: '#f-q',
  set: '#f-set',
  rar: '#f-rar',
  tipo: '#f-tipo',
  lang: '#f-lang',
  variant: '#f-var',
  min: '#f-min',
  max: '#f-max',
  sort: '#f-sort',
};

const options = (pairs: [string, string][], label: string) =>
  `<option value="">${label}</option>${pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}`;

/** As opções saem das cartas à venda de agora (o catálogo chega do Notion depois da página): refaz a cada vez. */
const fillFilters = () => {
  const o = filterOptions();
  const same = (list: string[]): [string, string][] => list.map((v) => [v, v]);
  $('#f-set').innerHTML = options(o.sets, 'todos os sets');
  $('#f-rar').innerHTML = options(same(o.rarities), 'todas as raridades');
  $('#f-tipo').innerHTML = options(
    o.types.map((t) => [t, TYPE_PT[t] ?? t]),
    'todos os tipos',
  );
  $('#f-lang').innerHTML = options(same(o.langs), 'todos os idiomas');
  $('#f-var').innerHTML = options(same(o.variants), 'todas as variantes');
  const sort = $<HTMLSelectElement>('#f-sort');
  if (sort.options.length) return;
  sort.innerHTML = [
    ['recentes', 'mais recentes'],
    ['menor', 'menor preço'],
    ['maior', 'maior preço'],
    ['az', 'A–Z'],
  ]
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join('');
  if (window.innerWidth < 860) $('#filtersBox').removeAttribute('open');
};

const syncFilters = () => {
  for (const [k, sel] of Object.entries(FIELDS)) $<HTMLInputElement>(sel).value = F[k as keyof typeof FIELDS];
  $<HTMLInputElement>('#f-grad').checked = F.graded;
  $<HTMLInputElement>('#f-stock').checked = F.stock;
};

const renderGrid = () => {
  const list = filterItems(F);
  $('#tcgCount').textContent = `${list.length}${list.length === 1 ? ' item' : ' itens'}`;
  $('#tcgGrid').innerHTML = list.length
    ? list.map(itemTile).join('')
    : emptyState(
        'nada encontrado.',
        'Nenhum item com esses filtros. Afrouxe um filtro ou limpe tudo.',
        '<button class="btn btn--ghost btn--sm" data-action="filters-clear">limpar filtros</button>',
        'grid-column:1/-1',
      );
};

// ───────── enciclopédia (dados da API; o TCGdex é a fonte) ─────────

const wait = (text: string) => `<p class="soft" role="status" style="padding:28px 0">${esc(text)}</p>`;
const failure = (e: unknown) =>
  `${alertMsg((e as Error).message)}<p style="margin-top:12px"><button class="btn btn--ghost btn--sm" data-action="tcg-retry">tentar de novo</button></p>`;

let sets: TcgSetInfo[] | null = null;
let setNames = new Map<string, TcgSetInfo>();
let index: IndexEntry[] | null = null;
let cardQ = '';
let setCardQ = '';
let shown = PAGE;

const loadSets = async () => {
  sets ??= parseSets(await api.tcgSets());
  setNames = new Map(sets.map((x) => [x.id, x]));
  return sets;
};

const setCard = (x: TcgSetInfo, onSale: Map<string, number>) => {
  const n = onSale.get(x.id) ?? 0;
  const sale = n
    ? `<span class="mono tag">${n} à venda na cubodex</span>`
    : '<span class="mono muted">nenhuma à venda</span>';
  const logo = x.logo
    ? `<img class="setlogo" src="${logoUrl(x.logo)}" alt="" width="76" height="76" loading="lazy" decoding="async">`
    : '<span class="setlogo"></span>';
  return `<a class="setcard" href="#/set/${esc(x.id)}" data-action="go" data-view="set" data-id="${esc(x.id)}">${logo}<span style="min-width:0"><b class="setname">${esc(setTitle(x))}</b><br><span class="mono muted">${setYear(x)} · ${x.official || x.total} cartas</span><br>${sale}</span></a>`;
};

const renderSetsBody = (list: TcgSetInfo[]) => {
  const onSale = onSaleBySet();
  const filtered = filterSetList(list, S.setQ, S.setAno);
  const open = !!(S.setQ || S.setAno);
  // Só a série mais nova abre: cada logo é uma imagem, e fechadas elas nem são baixadas.
  $('#setsBody').innerHTML = filtered.length
    ? groupBySerie(filtered)
        .map(
          (g, i) =>
            `<details class="sets-group"${open || i === 0 ? ' open' : ''}><summary><h2 class="display">${esc(g.serie)}</h2><span class="mono muted">${g.sets.length} sets</span></summary><div class="grid-sets">${g.sets.map((x) => setCard(x, onSale)).join('')}</div></details>`,
        )
        .join('')
    : emptyState('nenhum set encontrado.', 'Tente outro nome ou outro ano.');
};

const renderSets = async () => {
  $<HTMLInputElement>('#s-q').value = S.setQ;
  $<HTMLInputElement>('#s-card').value = cardQ;
  $('#setsBody').innerHTML = wait('carregando os sets…');
  try {
    const list = await loadSets();
    if (currentView() !== 'sets') return;
    const ys = $<HTMLSelectElement>('#s-ano');
    ys.innerHTML = `<option value="">todos os anos</option>${setYears(list)
      .map((y) => `<option value="${y}">${y}</option>`)
      .join('')}`;
    ys.value = S.setAno;
    renderSetsBody(list);
    void renderCardResults();
  } catch (e) {
    if (currentView() === 'sets') $('#setsBody').innerHTML = failure(e);
  }
};

/** Busca por nome em todas as cartas: o índice (só nomes) é baixado uma vez e a busca roda no navegador. */
const renderCardResults = async () => {
  const box = $('#cardResults');
  if (cardQ.trim().length < 2) {
    box.innerHTML = '';
    return;
  }
  try {
    index ??= parseIndex(await api.tcgIndex());
    const found = searchIndex(index, cardQ);
    if (cardQ.trim().length < 2) return;
    box.innerHTML = found.length
      ? `<ul class="card-results">${found
          .map(
            ([id, name, pt, set]) =>
              `<li><a href="#/carta/${esc(id)}" data-action="go" data-view="carta" data-id="${esc(id)}">${esc(pt && pt !== name ? `${name} · ${pt}` : name)}</a> <span class="mono muted">${esc(setNames.get(set)?.name ?? set)}</span></li>`,
          )
          .join('')}</ul>`
      : '<p class="soft">Nenhuma carta com esse nome.</p>';
  } catch (e) {
    box.innerHTML = failure(e);
  }
};

const tcgTile = (c: TcgCardInfo, x: TcgSetInfo) => {
  const items = itemsOfTcgdexCard(c.id);
  const sale = items.length
    ? `<span class="mono tag">à venda · a partir de ${brl(Math.min(...items.map((i) => i.price)))}</span>`
    : '';
  const img = c.image
    ? `<img src="${cardImageUrl(c.image)}" alt="" width="245" height="337" loading="lazy" decoding="async">`
    : '';
  const name = esc(setTitleOf(c));
  return `<article class="tile${items.length ? ' hit' : ''}"><a class="media media--card" href="#/carta/${esc(c.id)}" data-action="go" data-view="carta" data-id="${esc(c.id)}" aria-label="Ver ${name}">${img}</a><div class="body"><span class="mono muted num">${esc(numberLabel(c, x))}</span><h3><a href="#/carta/${esc(c.id)}" data-action="go" data-view="carta" data-id="${esc(c.id)}" style="text-decoration:none">${esc(c.name)}</a></h3>${c.name_pt && c.name_pt !== c.name ? `<p class="mono muted">${esc(c.name_pt)}</p>` : ''}<p class="mono muted">${esc(c.rarity ?? '')}</p>${sale}</div></article>`;
};

const setTitleOf = (c: TcgCardInfo) => (c.name_pt && c.name_pt !== c.name ? `${c.name} · ${c.name_pt}` : c.name);

const renderSetCards = (cards: TcgCardInfo[], x: TcgSetInfo) => {
  const list = filterCardList(cards, setCardQ, S.setRar).filter((c) => !S.setOnly || itemsOfTcgdexCard(c.id).length);
  const part = list.slice(0, shown);
  $('#setCount').textContent = `mostrando ${part.length} de ${list.length} cartas do set`;
  $('#setGrid').innerHTML = part.length
    ? part.map((c) => tcgTile(c, x)).join('')
    : emptyState('nenhuma carta aqui.', 'Nenhuma carta com esse filtro neste set.', '', 'grid-column:1/-1');
  $('#setMore').hidden = part.length >= list.length;
};

let current: { set: TcgSetInfo; cards: TcgCardInfo[] } | null = null;

const renderSet = async () => {
  const id = S.setId;
  $('#setBody').innerHTML = wait('carregando o set…');
  try {
    const data = (await api.tcgSet(id)) as { set?: unknown; cards?: unknown };
    if (currentView() !== 'set' || S.setId !== id) return;
    const x = parseSet(data.set);
    if (!x) throw new Error('Set não encontrado.');
    const cards = (Array.isArray(data.cards) ? data.cards : []).flatMap((c) => parseCardInfo(c) ?? []);
    current = { set: x, cards };
    shown = PAGE;
    setCardQ = '';
    const rarities = uniq(cards.map((c) => c.rarity ?? '').filter(Boolean));
    const chips = `<button class="chip" data-action="set-rar" data-v="" aria-pressed="${!S.setRar}">todas</button>${rarities
      .map(
        (r) =>
          `<button class="chip" data-action="set-rar" data-v="${esc(r)}" aria-pressed="${S.setRar === r}">${esc(r)}</button>`,
      )
      .join('')}`;
    const logo = x.logo
      ? `<img class="setpage-logo" src="${logoUrl(x.logo)}" alt="" height="64" decoding="async">`
      : '';
    $('#setBody').innerHTML =
      `<p style="padding-top:20px"><a class="link-more" href="#/sets" data-action="go" data-view="sets">← todos os sets</a></p>` +
      `<div class="page-title" style="padding-inline:0"><span class="eyebrow mono">${esc(x.serie)} · ${setYear(x)}</span><h1 class="display">${esc(setTitle(x))}</h1><p>${x.official || x.total} cartas no set${x.total > x.official && x.official ? `, mais ${x.total - x.official} secretas` : ''}.</p>${logo}</div>` +
      `<p class="mono muted" style="margin-top:14px" id="setCount"></p>` +
      `<div class="toolbar"><div class="search"><input class="input" id="set-q" data-input="set-q" type="search" placeholder="buscar nesta lista" aria-label="Buscar carta neste set"></div><div class="chips" role="group" aria-label="Raridade">${chips}</div><button class="chip" data-action="set-only" aria-pressed="${S.setOnly}">só as que a cubodex tem</button></div>` +
      `<div class="grid" id="setGrid"></div><p style="margin-top:20px"><button class="btn btn--ghost" id="setMore" data-action="set-more">mostrar mais</button></p>`;
    renderSetCards(cards, x);
  } catch (e) {
    if (currentView() === 'set') $('#setBody').innerHTML = failure(e);
  }
};

const renderCarta = async () => {
  const id = S.cardId;
  $('#cartaBody').innerHTML = wait('carregando a carta…');
  try {
    const data = (await api.tcgCard(id)) as { card?: unknown; set?: unknown };
    if (currentView() !== 'carta' || S.cardId !== id) return;
    const c = parseCardInfo(data.card);
    const x = parseSet(data.set);
    if (!c || !x) throw new Error('Carta não encontrada.');
    const items = itemsOfTcgdexCard(c.id);
    const own = items[0]?.photos?.[0];
    const src = own ? photoUrl(own) : c.image ? cardImageUrl(c.image, 'high') : '';
    const rows = items.length
      ? items.map(saleRow).join('')
      : '<p class="soft">A Cubodex não tem item à venda desta carta agora.</p>';
    const list = (csv: string | null, map: Record<string, string>) =>
      esc(
        (csv ?? '')
          .split(',')
          .filter(Boolean)
          .map((v) => map[v] ?? v)
          .join(', '),
      );
    $('#cartaBody').innerHTML =
      `<p style="padding-top:20px"><a class="link-more" href="#/set/${esc(x.id)}" data-action="go" data-view="set" data-id="${esc(x.id)}">← ${esc(x.name)}</a></p>` +
      `<div class="cardpage"><div class="media media--card" style="margin:0;width:100%">${src ? `<img src="${esc(src)}" alt="Carta ${esc(c.name)}, ${esc(x.name)} ${esc(numberLabel(c, x))}" width="600" height="825" decoding="async">` : ''}</div>` +
      `<div><span class="eyebrow mono">${esc(x.name)} · ${esc(numberLabel(c, x))}</span><h1 class="display" style="font-size:clamp(44px,7vw,84px)">${esc(c.name)}</h1>${c.name_pt && c.name_pt !== c.name ? `<p class="soft">${esc(c.name_pt)}</p>` : ''}` +
      `<dl class="spec"><dt>set</dt><dd>${esc(setTitle(x))}</dd><dt>número</dt><dd>${esc(numberLabel(c, x))}</dd><dt>raridade</dt><dd>${esc(c.rarity ?? '—')}</dd><dt>tipo</dt><dd>${list(c.types, TYPE_PT) || '—'}</dd><dt>variantes</dt><dd>${list(c.variants, VARIANT_PT) || '—'}</dd></dl>` +
      `<div class="section-head" style="margin-bottom:0"><h2 class="display" style="font-size:28px">à venda</h2></div>${rows}</div></div>`;
  } catch (e) {
    if (currentView() === 'carta') $('#cartaBody').innerHTML = failure(e);
  }
};

let accGroup: 'all' | 'pack' | 'acc' = 'all';

/** Packs e acessórios: o filtro separa o lacrado do TCG (group "pack") do resto. */
const renderAcc = () => {
  const list = listedOf('acc').filter(
    (p) => accGroup === 'all' || (p.kind === 'acc' && !!p.group) === (accGroup === 'pack'),
  );
  $('#accGrid').innerHTML = list.length
    ? ''
    : '<p class="soft" style="padding:14px 0">Nada nessa seleção por enquanto.</p>';
  if (list.length) fillProducts($('#accGrid'), list);
  for (const b of $$('#accFilter button')) b.setAttribute('aria-pressed', String(b.dataset.g === accGroup));
};

export const initTcg = () => {
  registerView('tcg', () => {
    fillFilters();
    syncFilters();
    renderGrid();
  });
  registerView('acessorios', renderAcc);
  onAction('acc-group', (el) => {
    accGroup = el.dataset.g === 'pack' || el.dataset.g === 'acc' ? el.dataset.g : 'all';
    renderAcc();
  });
  registerView('sets', renderSets);
  registerView('set', renderSet);
  registerView('carta', renderCarta);

  onInput('filter', (el) => {
    const input = el as HTMLInputElement;
    const key = input.dataset.f as keyof Filters;
    F = { ...F, [key]: input.type === 'checkbox' ? input.checked : input.value };
    renderGrid();
  });
  onAction('filters-clear', () => {
    F = emptyFilters();
    syncFilters();
    renderGrid();
  });
  onInput('sets-q', (el) => {
    S.setQ = (el as HTMLInputElement).value;
    if (sets) renderSetsBody(sets);
  });
  onInput('sets-year', (el) => {
    S.setAno = (el as HTMLSelectElement).value;
    if (sets) renderSetsBody(sets);
  });
  onInput('card-search', (el) => {
    cardQ = (el as HTMLInputElement).value;
    void renderCardResults();
  });
  onInput('set-q', (el) => {
    setCardQ = (el as HTMLInputElement).value;
    shown = PAGE;
    if (current) renderSetCards(current.cards, current.set);
  });
  const again = () => {
    shown = PAGE;
    if (current) renderSetCards(current.cards, current.set);
  };
  onAction('set-rar', (el) => {
    S.setRar = el.dataset.v ?? '';
    for (const b of $$('#setBody [data-action="set-rar"]'))
      b.setAttribute('aria-pressed', String(b.dataset.v === S.setRar));
    again();
  });
  onAction('set-only', (el) => {
    S.setOnly = !S.setOnly;
    el.setAttribute('aria-pressed', String(S.setOnly));
    again();
  });
  onAction('set-more', () => {
    shown += PAGE;
    if (current) renderSetCards(current.cards, current.set);
  });
  // Falhou a carga de uma tela da enciclopédia: pede de novo e desenha a tela atual.
  onAction('tcg-retry', () => {
    const view = currentView();
    if (view === 'sets') void renderSets();
    else if (view === 'set') void renderSet();
    else if (view === 'carta') void renderCarta();
  });
};
