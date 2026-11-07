/**
 * Página do set da coleção interna (#80): números do set, abas, grade de cartas e marcação. A posse mostrada é a do
 * servidor mais as mudanças ainda a caminho (atualização otimista, com reversão se a API recusar).
 */
import {
  allMarked,
  bulkPairs,
  filterTiles,
  filterTrade,
  type Own,
  ownKey,
  parseStockItems,
  progress,
  releaseLabel,
  type StockItem,
  secretCount,
  type Tab,
  type Tile,
  type TradeRow,
  tiles,
  tradeRows,
  variantsOf,
  withQty,
} from '../domain/colecao';
import { cardImageUrl, numberLabel, type TcgCardInfo, type TcgSetInfo } from '../domain/enciclopedia';
import { brl, escapeHtml as esc } from '../domain/format';
import { VARIANT_PT } from '../domain/tcg';
import { api } from '../infra/api';
import { emptyState } from './art';
import { $, $$, onAction, onInput } from './dom';
import { toast } from './toast';

const PAGE = 60;
const MAX_QTY = 999;

/** As abas da grade (Tab) mais "Para trocar", que é uma lista à parte e não mexe em marcação. */
type PageTab = Tab | 'trocar';

interface Page {
  el: HTMLElement;
  set: TcgSetInfo;
  cards: TcgCardInfo[];
  own: Own;
  tab: PageTab;
  /** Estoque da loja (Notion) deste set, pedido na primeira vez que a aba "Para trocar" abre. */
  stock: StockItem[] | null;
  stockState: 'parado' | 'carregando' | 'erro';
  stockError: string;
  /** Produtos com ajuste em andamento: os botões ficam desligados até a resposta. */
  busy: Set<string>;
  q: string;
  variantsOn: boolean;
  shown: number;
}

let page: Page | null = null;
/** Carta que abriu o seletor: ao fechar, o foco volta ao selo dela (o quadrado pode ter sido refeito no meio). */
let openedBy: string | null = null;

const list = (p: Page): Tile[] => tiles(p.cards, p.own, p.variantsOn);
const visibleTiles = (p: Page): Tile[] => filterTiles(list(p), p.tab === 'trocar' ? 'todas' : p.tab, p.q);
const trade = (p: Page): TradeRow[] => tradeRows(p.cards, p.stock ?? []);

// ───────── desenho ─────────

const ICON = {
  date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  cards:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="7" y="3" width="13" height="17" rx="2"/><path d="M4 7v13a1 1 0 0 0 1 1h11"/></svg>',
  secret:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  value:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5C14 8.6 13.1 8 12 8c-1.4 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.6-2.5-1.5M12 6.5V8m0 8v1.5"/></svg>',
};

const stat = (icon: string, value: string, label: string) =>
  `<div class="cx-stat">${icon}<b class="num">${value}</b><span class="mono muted">${label}</span></div>`;

const drawStats = (p: Page) => {
  const pr = progress(list(p));
  $('#cxStats', p.el).innerHTML =
    stat(ICON.date, esc(releaseLabel(p.set.released) || '—'), 'lançamento') +
    stat(ICON.cards, String(p.cards.length), 'cartas') +
    stat(ICON.secret, String(secretCount(p.set)), 'secretas') +
    `<div class="cx-stat"><span class="cx-ring" style="--p:${pr.pct}" role="img" aria-label="${pr.pct}% completa"><b class="num">${pr.pct}%</b></span><b class="num">${pr.have}/${pr.total}</b><span class="mono muted">${pr.complete ? 'completa ✓' : 'progresso'}</span></div>` +
    stat(ICON.value, '—', 'valor em breve');
};

const TABS: [PageTab, string][] = [
  ['todas', 'todas'],
  ['tenho', 'tenho'],
  ['preciso', 'preciso'],
  ['trocar', 'para trocar'],
];

const drawTabs = (p: Page) => {
  const all = list(p);
  const count = (t: PageTab) => (t === 'trocar' ? trade(p).length : filterTiles(all, t, '').length);
  $('#cxTabs', p.el).innerHTML = TABS.map(
    ([tab, label]) =>
      `<button class="chip" type="button" data-action="cx-tab" data-tab="${tab}" aria-pressed="${p.tab === tab}">${label} <span class="num">${count(tab)}</span></button>`,
  ).join('');
};

const drawBulk = (p: Page) => {
  $('.cx-actions', p.el).hidden = p.tab === 'trocar';
  if (p.tab === 'trocar') return;
  const shown = visibleTiles(p);
  const btn = $<HTMLButtonElement>('#cxBulk', p.el);
  const off = allMarked(shown);
  btn.disabled = !shown.length;
  btn.dataset.on = String(!off);
  btn.textContent = off ? 'desmarcar todas' : 'selecionar todas';
};

const stateLabel = (qty: number) => (qty <= 0 ? 'falta' : qty === 1 ? 'tenho' : `tenho ${qty}`);

const tileHtml = (p: Page, t: Tile) => {
  const c = t.card;
  const state = t.qty <= 0 ? 'falta' : t.qty === 1 ? 'tenho' : 'repetida';
  const name = esc(c.name);
  const img = c.image
    ? `<img src="${cardImageUrl(c.image)}" alt="" width="245" height="337" loading="lazy" decoding="async">`
    : '';
  const badge = t.qty <= 0 ? '+' : t.qty === 1 ? '✓' : `×${t.qty}`;
  const variant = t.variant ? `<span class="mono muted">${esc(VARIANT_PT[t.variant] ?? t.variant)}</span>` : '';
  return (
    `<div class="cx-tile" data-state="${state}" data-card="${esc(c.id)}" data-key="${esc(c.id)}|${esc(t.variant ?? '')}">` +
    `<button class="cx-tile-main" type="button" data-action="cx-mark" data-card="${esc(c.id)}" data-variant="${esc(t.variant ?? '')}" aria-pressed="${t.qty > 0}" aria-label="${name}${t.variant ? `, ${esc(VARIANT_PT[t.variant] ?? t.variant)}` : ''}: ${stateLabel(t.qty)}">` +
    `<span class="cx-art">${img}</span>` +
    `<span class="cx-tile-name"><span class="mono num">${esc(numberLabel(c, p.set))}</span> ${name}</span>${variant}</button>` +
    `<button class="cx-qty" type="button" data-action="cx-open" data-card="${esc(c.id)}" aria-label="Quantidades de ${name}"><b class="num">${badge}</b></button></div>`
  );
};

const money = (v: number | null | undefined) => (typeof v === 'number' ? brl(v) : '');

const tradeHtml = (p: Page, r: TradeRow) => {
  const c = r.card;
  const img = c.image
    ? `<img src="${cardImageUrl(c.image)}" alt="" width="245" height="337" loading="lazy" decoding="async">`
    : '';
  const detail = [VARIANT_PT[r.variant] ?? r.variant, r.lang, r.grade].filter(Boolean).map(esc).join(' · ');
  const price = `<b class="num">${esc(money(r.price))}</b>`;
  const off = p.busy.has(r.id) ? ' disabled' : '';
  const side =
    r.qty === null
      ? price
      : `${price}<span class="cx-step"><button type="button" data-action="cx-stock" data-id="${esc(r.id)}" data-d="-1" aria-label="Tirar uma unidade de ${esc(c.name)}"${off}>−</button>` +
        `<output class="num" aria-label="${r.qty} unidades">${r.qty}</output>` +
        `<button type="button" data-action="cx-stock" data-id="${esc(r.id)}" data-d="1" aria-label="Pôr uma unidade de ${esc(c.name)}"${off}>+</button></span>`;
  return (
    `<div class="cx-trade"><span class="cx-trade-art">${img}</span>` +
    `<span class="cx-trade-info"><b>${esc(c.name)}</b><span class="mono muted">${esc(numberLabel(c, p.set))}${detail ? ` · ${detail}` : ''}</span></span>` +
    `<span class="cx-trade-side">${side}</span></div>`
  );
};

/** Aba "Para trocar": o estoque da loja (Notion) neste set. */
const drawTrade = (p: Page) => {
  const rows = filterTrade(trade(p), p.q);
  const note =
    p.stockState === 'carregando'
      ? '<p class="soft" role="status">carregando o estoque da loja…</p>'
      : p.stockState === 'erro'
        ? `<div class="msg" role="alert">Estoque da loja indisponível: ${esc(p.stockError)} <button class="btn btn--ghost btn--sm" type="button" data-action="cx-stock-retry">tentar de novo</button></div>`
        : '';
  $('#cxGrid', p.el).innerHTML =
    note +
    (rows.length
      ? rows.map((r) => tradeHtml(p, r)).join('')
      : p.stockState === 'carregando'
        ? ''
        : emptyState('nada para trocar.', 'A loja não tem estoque de cartas deste set.'));
  $('#cxMore', p.el).hidden = true;
  drawBulk(p);
};

/** Ajusta o estoque da loja em ±1. Zerar tira a carta de venda, então pede confirmação; o "+" desfaz. */
const adjustStock = async (p: Page, id: string, delta: 1 | -1) => {
  const item = p.stock?.find((s) => s.id === id);
  if (!item || p.busy.has(id)) return;
  if (
    delta < 0 &&
    item.available === 1 &&
    !window.confirm('Isto zera o estoque e tira a carta de venda na loja. Continuar?')
  )
    return;
  p.busy.add(id);
  drawTrade(p);
  try {
    item.available = (await api.colecaoAjustaEstoque(id, delta)).available;
  } catch (e) {
    toast(`não deu para ajustar: ${(e as Error).message}`);
  }
  p.busy.delete(id);
  if (page === p && p.tab === 'trocar') drawTrade(p);
};

const loadStock = async (p: Page) => {
  if (p.stock || p.stockState === 'carregando') return;
  p.stockState = 'carregando';
  drawTrade(p);
  try {
    p.stock = parseStockItems(await api.colecaoEstoque(p.set.id));
    p.stockState = 'parado';
  } catch (e) {
    p.stockState = 'erro';
    p.stockError = (e as Error).message;
  }
  if (page === p && p.tab === 'trocar') {
    drawTabs(p);
    drawTrade(p);
  }
};

const drawGrid = (p: Page) => {
  if (p.tab === 'trocar') return drawTrade(p);
  const all = visibleTiles(p);
  const grid = $('#cxGrid', p.el);
  grid.innerHTML = all.length
    ? all
        .slice(0, p.shown)
        .map((t) => tileHtml(p, t))
        .join('')
    : emptyState(
        p.tab === 'tenho' ? 'nenhuma carta ainda.' : 'nada por aqui.',
        p.tab === 'preciso' && !p.q ? 'Você tem todas as cartas deste set.' : 'Nenhuma carta com esse filtro.',
      );
  $('#cxMore', p.el).hidden = all.length <= p.shown;
  drawBulk(p);
};

const drawAll = (p: Page) => {
  drawStats(p);
  drawTabs(p);
  drawGrid(p);
};

/** Troca só os quadrados da carta (e os números do topo): a grade não é refeita a cada toque. */
const refreshCard = (p: Page, cardId: string) => {
  const card = p.cards.find((c) => c.id === cardId);
  if (!card) return;
  const fresh = new Map(tiles([card], p.own, p.variantsOn).map((t) => [`${cardId}|${t.variant ?? ''}`, t]));
  for (const el of $$('.cx-tile', p.el)) {
    const t = el.dataset.card === cardId ? fresh.get(el.dataset.key ?? '') : undefined;
    if (t) el.outerHTML = tileHtml(p, t);
  }
  drawStats(p);
  drawTabs(p);
  drawBulk(p);
};

// ───────── marcação e sincronização ─────────

/** Um pedido por carta e variante de cada vez; toques que chegam no meio valem só pelo último. */
const busy = new Map<string, { next?: number }>();

const sync = async (p: Page, cardId: string, variant: string, qty: number, saved: number) => {
  const key = ownKey(cardId, variant);
  const slot = busy.get(key);
  if (slot) {
    slot.next = qty;
    return;
  }
  busy.set(key, {});
  let sent = qty;
  let known = saved;
  try {
    for (;;) {
      await api.colecaoItem(cardId, variant, sent);
      known = sent;
      const next = busy.get(key)?.next;
      if (next === undefined || next === sent) break;
      sent = next;
      busy.set(key, {});
    }
  } catch (e) {
    p.own = withQty(p.own, cardId, variant, known);
    if (page === p) {
      refreshCard(p, cardId);
      refreshSheet(p);
    }
    toast(`não deu para salvar: ${(e as Error).message}`);
  } finally {
    busy.delete(key);
  }
};

const setQty = (p: Page, cardId: string, variant: string, qty: number) => {
  const before = p.own[ownKey(cardId, variant)] ?? 0;
  p.own = withQty(p.own, cardId, variant, qty);
  refreshCard(p, cardId);
  refreshSheet(p);
  void sync(p, cardId, variant, qty, before);
};

const tileOf = (p: Page, cardId: string, variant: string): Tile | undefined => {
  const card = p.cards.find((c) => c.id === cardId);
  return card ? tiles([card], p.own, p.variantsOn).find((t) => (t.variant ?? '') === variant) : undefined;
};

/** Toque na carta: marca a variante do quadrado (a principal, no modo simples) ou, se já tem, tira todas as dele. */
const toggle = (p: Page, cardId: string, variant: string) => {
  const t = tileOf(p, cardId, variant);
  if (!t) return;
  const on = t.qty <= 0;
  for (const [id, v] of bulkPairs([t], on)) if (on || p.own[ownKey(id, v)]) setQty(p, id, v, on ? 1 : 0);
};

const bulk = async (p: Page, on: boolean) => {
  const shown = visibleTiles(p);
  const pairs = bulkPairs(shown, on);
  if (!pairs.length) return;
  // Conta o que o usuário vê (cartas, ou variantes no modo variantes), não os pares enviados.
  const n = shown.filter((t) => (on ? t.qty <= 0 : t.qty > 0)).length;
  const unit = p.variantsOn ? 'item' : 'carta';
  if (!window.confirm(`${on ? 'Marcar' : 'Desmarcar'} ${n} ${n === 1 ? unit : `${unit}s`} de ${p.set.name}?`)) return;
  const before = p.own;
  for (const [id, v] of pairs) p.own = withQty(p.own, id, v, on ? 1 : 0);
  drawAll(p);
  const btn = $<HTMLButtonElement>('#cxBulk', p.el);
  btn.disabled = true;
  try {
    await api.colecaoMarcar(p.set.id, on, pairs);
  } catch (e) {
    p.own = before;
    if (page === p) drawAll(p);
    toast(`não deu para salvar: ${(e as Error).message}`);
  }
  if (page === p) drawBulk(p);
};

// ───────── seletor de quantidades ─────────

const sheetLayer = () => $('#cxSheet');
let sheetCard: string | null = null;

const sheetBody = (p: Page, card: TcgCardInfo) =>
  `<div class="cx-sheet-top"><b class="display" id="cxSheetTitle">${esc(card.name)}</b><button class="icon-link" type="button" data-action="cx-close" aria-label="Fechar">✕</button></div>` +
  variantsOf(card)
    .map((v) => {
      const qty = p.own[ownKey(card.id, v)] ?? 0;
      return `<div class="cx-vrow"><span>${esc(VARIANT_PT[v] ?? v)}</span><span class="cx-step"><button type="button" data-action="cx-step" data-card="${esc(card.id)}" data-variant="${esc(v)}" data-d="-1" aria-label="Menos uma ${esc(VARIANT_PT[v] ?? v)}"${qty <= 0 ? ' disabled' : ''}>−</button><output class="num" aria-live="polite">${qty}</output><button type="button" data-action="cx-step" data-card="${esc(card.id)}" data-variant="${esc(v)}" data-d="1" aria-label="Mais uma ${esc(VARIANT_PT[v] ?? v)}"${qty >= MAX_QTY ? ' disabled' : ''}>+</button></span></div>`;
    })
    .join('');

function refreshSheet(p: Page) {
  const card = sheetCard ? p.cards.find((c) => c.id === sheetCard) : undefined;
  if (!card || sheetLayer().hidden) return;
  const focused = document.activeElement as HTMLElement | null;
  const key = focused?.dataset.action === 'cx-step' ? `${focused.dataset.variant}|${focused.dataset.d}` : '';
  $('.cx-panel', sheetLayer()).innerHTML = sheetBody(p, card);
  const again = key
    ? $$<HTMLButtonElement>('.cx-panel [data-action="cx-step"]').find(
        (b) => `${b.dataset.variant}|${b.dataset.d}` === key,
      )
    : null;
  if (again && !again.disabled) again.focus();
  else if (key) $<HTMLButtonElement>('.cx-panel [data-action="cx-close"]').focus();
}

const openSheet = (p: Page, cardId: string) => {
  const card = p.cards.find((c) => c.id === cardId);
  if (!card) return;
  sheetCard = cardId;
  openedBy = cardId;
  $('.cx-panel', sheetLayer()).innerHTML = sheetBody(p, card);
  sheetLayer().hidden = false;
  $<HTMLButtonElement>('.cx-panel [data-action="cx-close"]').focus();
};

const closeSheet = () => {
  if (sheetLayer().hidden) return;
  sheetLayer().hidden = true;
  sheetCard = null;
  const back = page?.el.querySelector<HTMLElement>(`.cx-tile[data-card="${CSS.escape(openedBy ?? '')}"] .cx-qty`);
  back?.focus();
  openedBy = null;
};

// ───────── entrada ─────────

export const openSetPage = (el: HTMLElement, set: TcgSetInfo, cards: TcgCardInfo[], own: Own) => {
  closeSheet();
  const p: Page = {
    el,
    set,
    cards,
    own,
    tab: 'todas',
    stock: null,
    stockState: 'parado',
    busy: new Set(),
    stockError: '',
    q: '',
    variantsOn: false,
    shown: PAGE,
  };
  page = p;
  el.innerHTML =
    '<div class="cx-stats" id="cxStats"></div>' +
    '<div class="cx-tools"><div class="chips" id="cxTabs" role="group" aria-label="Mostrar"></div>' +
    '<div class="cx-actions"><button class="btn btn--ghost btn--sm" id="cxBulk" type="button" data-action="cx-bulk">selecionar todas</button>' +
    '<label class="cx-switch"><input type="checkbox" role="switch" data-input="cx-variants"><span class="cx-track" aria-hidden="true"></span><span>variantes</span></label></div></div>' +
    '<div class="search cx-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' +
    '<input class="input" data-input="cx-set-q" type="search" placeholder="buscar carta ou número" aria-label="Buscar carta ou número" autocomplete="off"></div>' +
    '<div class="cx-grid" id="cxGrid"></div>' +
    '<p class="cx-more" id="cxMore" hidden><button class="btn btn--ghost" type="button" data-action="cx-more">mostrar mais</button></p>';
  drawAll(p);
};

/** Saiu da página do set: fecha o seletor e esquece o set (pedidos ainda a caminho seguem sem mexer na tela). */
export const closeSetPage = () => {
  closeSheet();
  page = null;
};

export const initColecaoSet = () => {
  onAction('cx-mark', (el) => page && toggle(page, el.dataset.card ?? '', el.dataset.variant ?? ''));
  onAction('cx-open', (el) => page && openSheet(page, el.dataset.card ?? ''));
  onAction('cx-close', closeSheet);
  onAction('cx-step', (el) => {
    if (!page) return;
    const v = el.dataset.variant ?? '';
    const now = page.own[ownKey(el.dataset.card ?? '', v)] ?? 0;
    setQty(page, el.dataset.card ?? '', v, Math.min(MAX_QTY, Math.max(0, now + Number(el.dataset.d))));
  });
  onAction('cx-tab', (el) => {
    if (!page) return;
    page.tab = (el.dataset.tab as PageTab) ?? 'todas';
    page.shown = PAGE;
    drawTabs(page);
    drawGrid(page);
    if (page.tab === 'trocar') void loadStock(page);
  });
  onAction('cx-stock', (el) => page && void adjustStock(page, el.dataset.id ?? '', el.dataset.d === '-1' ? -1 : 1));
  onAction('cx-stock-retry', () => {
    if (!page) return;
    page.stockState = 'parado';
    void loadStock(page);
  });
  onAction('cx-more', () => {
    if (!page) return;
    page.shown += PAGE;
    drawGrid(page);
  });
  onAction('cx-bulk', (el) => page && void bulk(page, el.dataset.on === 'true'));
  onInput('cx-variants', (el) => {
    if (!page) return;
    page.variantsOn = (el as HTMLInputElement).checked;
    page.shown = PAGE;
    drawAll(page);
  });
  onInput('cx-set-q', (el) => {
    if (!page) return;
    page.q = (el as HTMLInputElement).value;
    page.shown = PAGE;
    drawGrid(page);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
};
