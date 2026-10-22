import { CARDS, cardById, cardImage, ITEMS, photoUrl, SETS, setById, type TcgSet } from '../domain/catalog';
import { escapeHtml as esc, uniq } from '../domain/format';
import { cardsOfSet, cardsOnSale, emptyFilters, type Filters, filterItems, filterSets } from '../domain/tcg';
import { emptyState } from './art';
import { $, onAction, onInput } from './dom';
import { registerView } from './router';
import { S } from './store';
import { cardTile, fillProducts, itemTile, saleRow } from './tiles';

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

const options = (values: string[], label: string) =>
  `<option value="">${label}</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;

const fillFilters = () => {
  const sel = $<HTMLSelectElement>('#f-set');
  if (sel.options.length > 1) return;
  sel.innerHTML = `<option value="">todos os sets</option>${SETS.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}`;
  $('#f-rar').innerHTML = options(uniq(CARDS.map((c) => c.rar)), 'todas as raridades');
  $('#f-tipo').innerHTML = options(uniq(CARDS.map((c) => c.tipo)), 'todos os tipos');
  $('#f-lang').innerHTML = options(['PT', 'EN'], 'todos os idiomas');
  $('#f-var').innerHTML = options(['normal', 'holo', 'reverse holo', '1ª edição'], 'todas as variantes');
  $('#f-sort').innerHTML = [
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

const setCard = (x: TcgSet) => {
  const n = cardsOnSale(x.id);
  const sale = n
    ? `<span class="mono tag">${n} à venda na cubodex</span>`
    : '<span class="mono muted">nenhuma à venda</span>';
  return `<a class="setcard" href="#/set/${x.id}" data-action="go" data-view="set" data-id="${x.id}"><span class="setlogo" style="background:${x.tone}"><b class="display">${esc(x.name)}</b></span><span style="min-width:0"><span class="mono muted">${x.year} · ${x.total} cartas</span><br>${sale}</span></a>`;
};

const renderSetsBody = () => {
  const list = filterSets(S.setQ, S.setAno);
  const groups = uniq(list.map((x) => x.serie));
  $('#setsBody').innerHTML = groups.length
    ? groups
        .map(
          (g) =>
            `<div class="sets-group"><h2 class="display">${esc(g)}</h2><div class="grid-sets">${list
              .filter((x) => x.serie === g)
              .map(setCard)
              .join('')}</div></div>`,
        )
        .join('')
    : emptyState('nenhum set encontrado.', 'Tente outro nome ou outro ano.');
};

const renderSets = () => {
  const ys = $<HTMLSelectElement>('#s-ano');
  if (ys.options.length < 2)
    ys.innerHTML = `<option value="">todos os anos</option>${uniq(SETS.map((x) => x.year))
      .sort()
      .map((y) => `<option value="${y}">${y}</option>`)
      .join('')}`;
  $<HTMLInputElement>('#s-q').value = S.setQ;
  ys.value = S.setAno;
  renderSetsBody();
};

const renderSet = () => {
  const x = setById[S.setId] ?? SETS[0];
  S.setId = x.id;
  const { all, shown } = cardsOfSet(x.id, S.setRar, S.setOnly);
  const chips = `<button class="chip" data-action="set-rar" data-v="" aria-pressed="${!S.setRar}">todas</button>${uniq(
    all.map((c) => c.rar),
  )
    .map(
      (r) =>
        `<button class="chip" data-action="set-rar" data-v="${esc(r)}" aria-pressed="${S.setRar === r}">${esc(r)}</button>`,
    )
    .join('')}`;
  const grid = shown.length
    ? shown.map(cardTile).join('')
    : emptyState('nenhuma carta aqui.', 'Nenhuma carta com esse filtro neste set.', '', 'grid-column:1/-1');
  $('#setBody').innerHTML =
    `<p style="padding-top:20px"><a class="link-more" href="#/sets" data-action="go" data-view="sets">← todos os sets</a></p>` +
    `<div class="page-title" style="padding-inline:0"><span class="eyebrow mono">${esc(x.serie)} · ${x.year}</span><h1 class="display">${esc(x.name)}</h1><p>${x.total} cartas no set. Idiomas: ${x.langs.join(', ')}.</p></div>` +
    `<p class="mono muted" style="margin-top:14px">mostrando ${shown.length} de ${x.total} cartas do set</p>` +
    `<div class="toolbar"><div class="chips" role="group" aria-label="Raridade">${chips}</div><button class="chip" data-action="set-only" aria-pressed="${S.setOnly}">só as que a cubodex tem</button></div>` +
    `<div class="grid" id="setGrid">${grid}</div>`;
};

const renderCarta = () => {
  const c = cardById[S.cardId] ?? CARDS[0];
  S.cardId = c.id;
  const x = setById[c.set];
  const its = ITEMS.filter((it) => it.card === c.id);
  const rows = its.length
    ? its.map(saleRow).join('')
    : '<p class="soft">A Cubodex não tem item à venda desta carta agora.</p>';
  $('#cartaBody').innerHTML =
    `<p style="padding-top:20px"><a class="link-more" href="#/set/${x.id}" data-action="go" data-view="set" data-id="${x.id}">← ${esc(x.name)}</a></p>` +
    `<div class="cardpage"><div class="media media--card" style="margin:0;width:100%"><img src="${its[0]?.photos?.[0] ? photoUrl(its[0].photos[0]) : cardImage(c, its[0]?.lang, 'high')}" alt="Carta ${esc(c.name)}, ${esc(x.name)} ${c.n}/${x.total}" width="600" height="825" decoding="async"></div>` +
    `<div><span class="eyebrow mono">${esc(x.name)} · ${c.n}/${x.total}</span><h1 class="display" style="font-size:clamp(44px,7vw,84px)">${esc(c.name)}</h1>` +
    `<dl class="spec"><dt>set</dt><dd>${esc(x.name)}</dd><dt>número</dt><dd>${c.n}/${x.total}</dd><dt>raridade</dt><dd>${esc(c.rar)}</dd><dt>tipo</dt><dd>${esc(c.tipo)}</dd><dt>idiomas</dt><dd>${x.langs.join(', ')}</dd></dl>` +
    `<div class="section-head" style="margin-bottom:0"><h2 class="display" style="font-size:28px">à venda</h2></div>${rows}</div></div>`;
};

export const initTcg = () => {
  registerView('tcg', () => {
    fillFilters();
    syncFilters();
    renderGrid();
  });
  registerView('acessorios', () => fillProducts($('#accGrid'), ['a1', 'a2', 'a3', 'a4']));
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
    renderSetsBody();
  });
  onInput('sets-year', (el) => {
    S.setAno = (el as HTMLSelectElement).value;
    renderSetsBody();
  });
  onAction('set-rar', (el) => {
    S.setRar = el.dataset.v ?? '';
    renderSet();
  });
  onAction('set-only', () => {
    S.setOnly = !S.setOnly;
    renderSet();
  });
};
