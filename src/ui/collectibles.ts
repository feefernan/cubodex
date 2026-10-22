import { packEntry } from '../domain/cart';
import {
  isListed,
  LAUNCH_DATE,
  MINIS,
  type Mini,
  PACK,
  PACK_SIZE,
  packPrice,
  productById,
  SERIES,
} from '../domain/catalog';
import { type Dex, type DexFilter, type DexStatus, dexTotals, filterDex, toggleDex } from '../domain/collection';
import { brl, escapeHtml as esc, pad3 } from '../domain/format';
import { countdown } from '../domain/validation';
import { cube, emptyState } from './art';
import { updateBadge } from './cart';
import { $, $$, disabledAttr, onAction } from './dom';
import { registerView } from './router';
import { pushDex } from './session';
import { persist, S } from './store';
import { productTile } from './tiles';
import { toast } from './toast';
import { loginPrompt } from './vault';

/** Contagem até o lançamento; sem data definida, "em breve". */
export const tickCountdowns = () => {
  const target = LAUNCH_DATE;
  for (const el of $$('.cd')) el.textContent = target ? countdown(target, Date.now()) : 'em breve';
};

export const dexBar = (dex: Dex) => {
  const t = dexTotals(dex);
  const spans = t.items
    .map((p) => `<span class="${dex[p.id] === 'have' ? 'on' : dex[p.id] === 'want' ? 'want' : ''}"></span>`)
    .join('');
  return `<div class="dex-bar" role="img" aria-label="${t.have} de ${t.total} coletados">${spans}</div>`;
};

const renderColecionaveis = () => {
  const t = dexTotals(S.dex);
  $('#seriesRow').innerHTML = SERIES.map((s) =>
    s.open
      ? `<a class="series" href="#/serie" data-action="go" data-view="serie"><div class="thumb">${cube('#F42744')}</div><div><span class="mono tag">${s.label} · disponível</span><h3>${s.name}</h3><p class="muted" style="font-size:14px">${t.total} miniaturas · ${t.have} na sua dex</p></div></a>`
      : `<div class="series locked"><div class="thumb mono muted" style="font-size:22px">?</div><div><span class="mono muted">${s.label} · em breve</span><h3>${s.name}</h3><p class="muted" style="font-size:14px">avise-me no lançamento</p></div></div>`,
  ).join('');
  $('#dexTeaser').innerHTML =
    `<div class="dex-top"><div><p class="mono muted">sua coleção</p><p class="dex-count num">${t.have}<small>de ${t.total} coletados</small></p></div>${dexBar(S.dex)}</div>`;
  tickCountdowns();
};

const renderSerie = () => {
  $('#pack').hidden = !PACK.listed;
  let slots = '';
  for (let i = 0; i < PACK_SIZE; i++) {
    const mini = productById[S.pack[i]] as Mini | undefined;
    slots += mini
      ? `<div class="slot filled" style="--c:${mini.color}">${cube(mini.color)}</div>`
      : `<div class="slot mono">${i + 1}</div>`;
  }
  const full = S.pack.length === PACK_SIZE;
  $('#pack').innerHTML =
    `<div class="slots">${slots}</div>` +
    `<div><h3 class="display" style="font-size:28px">monte seu pacote</h3><p class="soft" style="font-size:15px;margin-top:4px">Toque em “+ pacote” nas miniaturas abaixo. Pacote de ${PACK_SIZE}: a soma das miniaturas, com ${PACK.discount}% de desconto.${full ? ` Este pacote: <b class="num" style="color:var(--fg)">${brl(packPrice(S.pack))}</b>` : ''}</p></div>` +
    `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--ghost btn--sm" data-action="pack-clear"${disabledAttr(!S.pack.length)}>esvaziar</button><button class="btn" data-action="pack-buy"${disabledAttr(!full)}>${full ? 'adicionar pacote' : `faltam ${PACK_SIZE - S.pack.length}`}</button></div>`;
  $('#serieGrid').innerHTML = MINIS.filter(isListed).map(productTile).join('');
};

const STATUS_FILTERS: DexFilter[] = ['todos', 'tenho', 'quero', 'faltam'];

const dexGrid = () => {
  if (S.dexS !== 's1') {
    let grid = '';
    for (let i = 13; i <= 24; i++)
      grid += `<article class="dex-tile dex-locked"><div class="dex-art"><span class="mono num-tag">#${pad3(i)}</span>?</div><div class="dex-meta"><h3>???</h3><span class="mono muted">em breve</span></div><div style="height:14px"></div></article>`;
    return grid;
  }
  const items = filterDex(S.dex, S.dexF);
  if (!items.length)
    return emptyState('nenhuma miniatura aqui.', `Nada marcado como “${S.dexF}” nesta série.`, '', 'grid-column:1/-1');
  return items
    .map((p) => {
      const s = S.dex[p.id] ?? '';
      return `<article class="dex-tile ${s || 'none'}"><div class="dex-art" style="--c:${p.color}"><span class="mono num-tag">#${pad3(p.n)}</span>${cube(p.color)}</div><div class="dex-meta"><h3>${esc(p.name)}</h3><span class="mono muted">${esc(p.rar)}</span></div><div class="dex-actions"><button class="tog" data-action="dex" data-id="${p.id}" data-st="have" aria-pressed="${s === 'have'}">tenho</button><button class="tog" data-action="dex" data-id="${p.id}" data-st="want" aria-pressed="${s === 'want'}">quero</button></div></article>`;
    })
    .join('');
};

const renderDex = () => {
  const body = $('#dexBody');
  if (!S.user) {
    body.innerHTML = loginPrompt(
      'entre para ver sua dex.',
      'A dex fica salva na sua conta. Entre ou crie uma conta para marcar o que você tem e o que quer.',
    );
    return;
  }
  const t = dexTotals(S.dex);
  const chipsS = SERIES.map(
    (s) =>
      `<button class="chip" data-action="dex-series" data-v="${s.id}" aria-pressed="${S.dexS === s.id}">${s.label}${s.open ? '' : ' · em breve'}</button>`,
  ).join('');
  const chipsF = STATUS_FILTERS.map(
    (f) => `<button class="chip" data-action="dex-filter" data-v="${f}" aria-pressed="${S.dexF === f}">${f}</button>`,
  ).join('');
  body.innerHTML =
    `<div class="dex-top"><div><p class="mono muted">sua coleção${S.user.demo ? ' · demonstração' : ''}</p><p class="dex-count num">${t.have}<small>de ${t.total} coletados</small></p><p class="mono soft" style="margin-top:8px">${t.want} na lista de desejos</p></div>${dexBar(S.dex)}</div>` +
    `<div class="toolbar"><div class="chips" role="group" aria-label="Série">${chipsS}</div><div class="chips" role="group" aria-label="Filtrar">${chipsF}</div></div>` +
    `<div class="grid a-col">${dexGrid()}</div>`;
};

export const initCollectibles = () => {
  registerView('colecionaveis', renderColecionaveis);
  registerView('serie', renderSerie);
  registerView('dex', renderDex);
  setInterval(tickCountdowns, 1000);

  onAction('pack-add', (el) => {
    if (S.pack.length >= PACK_SIZE) {
      toast('pacote cheio');
      return;
    }
    S.pack.push(el.dataset.id ?? '');
    renderSerie();
    toast(`no pacote: ${S.pack.length} de ${PACK_SIZE}`);
  });
  onAction('pack-clear', () => {
    S.pack = [];
    renderSerie();
  });
  onAction('pack-buy', () => {
    const line = packEntry(S.pack, Date.now());
    if (line) {
      S.cart.push(line);
      S.pack = [];
      persist();
      updateBadge();
      toast('pacote no carrinho');
    }
    renderSerie();
  });
  onAction('dex', (el) => {
    toggleDex(S.dex, el.dataset.id ?? '', el.dataset.st as DexStatus);
    persist();
    pushDex();
    renderDex();
  });
  onAction('dex-series', (el) => {
    S.dexS = el.dataset.v ?? 's1';
    renderDex();
  });
  onAction('dex-filter', (el) => {
    S.dexF = el.dataset.v as DexFilter;
    renderDex();
  });
};
