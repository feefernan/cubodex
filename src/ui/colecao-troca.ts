/**
 * Folha "Registrar troca" da coleção interna (#100): o que sai do estoque da loja e o que entra na coleção, sem exigir
 * 1:1. Mostra só o valor do que sai (referência); a gravação é tudo ou nada no servidor.
 */
import { MAX_QTY, primaryVariant, type TradeRow, variantsOf } from '../domain/colecao';
import { type IndexEntry, parseCardInfo, parseIndex, searchIndex, type TcgCardInfo } from '../domain/enciclopedia';
import { brl, escapeHtml as esc } from '../domain/format';
import { VARIANT_PT } from '../domain/tcg';
import { api, type TradeResult } from '../infra/api';
import { $, onAction, onInput } from './dom';
import { toast } from './toast';

interface Got {
  cardId: string;
  name: string;
  variants: string[];
  variant: string;
  qty: number;
}

interface Trade {
  rows: TradeRow[];
  give: Map<string, number>;
  got: Got[];
  index: IndexEntry[] | null;
  busy: boolean;
  error: string;
  /** `current`: a folha ainda é esta troca (se foi fechada e outra abriu no meio, só os dados se aplicam). */
  done: (res: TradeResult, current: boolean) => void;
}

/** A troca aberta. Só os botões da folha chamam os ajustes abaixo, e a folha só existe com ela aberta. */
let t: Trade | null = null;
const open = () => t as Trade;
const layer = () => $('#cxSheet');

const stepper = (action: string, attrs: string, qty: number, max: number, label: string) =>
  `<span class="cx-step"><button type="button" data-action="${action}" ${attrs} data-d="-1" aria-label="Menos ${label}"${qty <= 0 ? ' disabled' : ''}>−</button>` +
  `<output class="num" aria-live="polite">${qty}</output>` +
  `<button type="button" data-action="${action}" ${attrs} data-d="1" aria-label="Mais ${label}"${qty >= max ? ' disabled' : ''}>+</button></span>`;

const drawGive = (tr: Trade) => {
  $('#cxTGive').innerHTML = tr.rows
    .map((r) => {
      const detail = [VARIANT_PT[r.variant] ?? r.variant, r.lang, r.grade].filter(Boolean).map(esc).join(' · ');
      const qty = tr.give.get(r.id) ?? 0;
      return `<div class="cx-vrow"><span>${esc(r.card.name)} <span class="mono muted">${detail} · ${r.price === null ? 'sem preço' : esc(brl(r.price))}</span></span>${stepper('cx-t-give', `data-id="${esc(r.id)}"`, qty, r.qty as number, esc(`${r.card.name}, ${VARIANT_PT[r.variant] ?? r.variant}`))}</div>`;
    })
    .join('');
};

const drawGet = (tr: Trade) => {
  $('#cxTGet').innerHTML = tr.got
    .map(
      (g, i) =>
        `<div class="cx-vrow"><span>${esc(g.name)}</span>` +
        `<select class="input" data-input="cx-t-var" data-i="${i}" aria-label="Variante de ${esc(g.name)}">${g.variants.map((v) => `<option value="${esc(v)}"${v === g.variant ? ' selected' : ''}>${esc(VARIANT_PT[v] ?? v)}</option>`).join('')}</select>` +
        `${stepper('cx-t-get', `data-i="${i}"`, g.qty, MAX_QTY, esc(`${g.name}, ${VARIANT_PT[g.variant] ?? g.variant}`))}</div>`,
    )
    .join('');
};

const drawFoot = (tr: Trade) => {
  const out = tr.rows.reduce((n, r) => n + (tr.give.get(r.id) ?? 0), 0);
  const value = tr.rows.reduce((n, r) => n + (tr.give.get(r.id) ?? 0) * (r.price ?? 0), 0);
  const inn = tr.got.reduce((n, g) => n + g.qty, 0);
  $('#cxTSum').textContent = `sai ${out} un. (${brl(value)}) · entra ${inn} un.`;
  $('#cxTErr').textContent = tr.error;
  $<HTMLButtonElement>('#cxTGo').disabled = tr.busy || !out || !inn;
};

const drawAll = (tr: Trade) => {
  drawGive(tr);
  drawGet(tr);
  drawFoot(tr);
};

/** `rows` só traz linhas com estoque controlado e maior que zero. */
export const openTrade = (rows: TradeRow[], startId: string, done: (res: TradeResult, current: boolean) => void) => {
  t = { rows, give: new Map([[startId, 1]]), got: [], index: null, busy: false, error: '', done };
  $('.cx-panel', layer()).innerHTML =
    '<div class="cx-sheet-top"><b class="display" id="cxSheetTitle">Registrar troca</b><button class="icon-link" type="button" data-action="cx-close" aria-label="Fechar">✕</button></div>' +
    '<h3 class="mono muted">eu dou</h3><div id="cxTGive"></div>' +
    '<h3 class="mono muted">eu recebo</h3><div id="cxTGet"></div>' +
    '<div class="search"><input class="input" data-input="cx-t-q" type="search" placeholder="buscar a carta recebida" aria-label="Buscar a carta recebida" autocomplete="off"></div>' +
    '<ul class="cx-t-found" id="cxTFound"></ul>' +
    '<p class="mono muted" id="cxTSum" role="status"></p><p class="msg" id="cxTErr" role="alert"></p>' +
    '<button class="btn" id="cxTGo" type="button" data-action="cx-t-go">registrar troca</button>';
  drawAll(t);
  layer().hidden = false;
  $<HTMLButtonElement>('.cx-panel [data-action="cx-close"]').focus();
};

const found = async (q: string) => {
  const box = $('#cxTFound');
  if (q.trim().length < 2) {
    box.innerHTML = '';
    return;
  }
  try {
    open().index ??= parseIndex(await api.tcgIndex());
  } catch (e) {
    box.innerHTML = `<li class="soft">${esc((e as Error).message)}</li>`;
    return;
  }
  const list = searchIndex(open().index as IndexEntry[], q, 6);
  box.innerHTML = list.length
    ? list
        .map(
          ([id, name, pt, set]) =>
            `<li><button class="btn btn--ghost btn--sm" type="button" data-action="cx-t-pick" data-id="${esc(id)}">${esc(pt && pt !== name ? `${name} · ${pt}` : name)} <span class="mono muted">${esc(set)}</span></button></li>`,
        )
        .join('')
    : '<li class="soft">Nenhuma carta com esse nome.</li>';
};

/** Cartas sendo abertas: um segundo toque no mesmo resultado antes da resposta não soma outra unidade. */
const picking = new Set<string>();

const pick = async (id: string) => {
  if (picking.has(id)) return;
  picking.add(id);
  const tr = open();
  try {
    const card = parseCardInfo(((await api.tcgCard(id)) as { card?: unknown }).card) as TcgCardInfo;
    if (t !== tr) return;
    const variant = primaryVariant(card);
    const same = tr.got.find((g) => g.cardId === id && g.variant === variant);
    if (same) same.qty = Math.min(MAX_QTY, same.qty + 1);
    else tr.got.push({ cardId: id, name: card.name, variants: variantsOf(card), variant, qty: 1 });
    $<HTMLInputElement>('[data-input="cx-t-q"]').value = '';
    $('#cxTFound').innerHTML = '';
    drawGet(tr);
    drawFoot(tr);
  } catch (e) {
    toast(`não deu para abrir a carta: ${(e as Error).message}`);
  } finally {
    picking.delete(id);
  }
};

const submit = async () => {
  const tr = open();
  tr.busy = true;
  tr.error = '';
  drawFoot(tr);
  try {
    const res = await api.colecaoTroca(
      [...tr.give].filter(([, qty]) => qty > 0).map(([id, qty]) => ({ id, qty })),
      tr.got.map(({ cardId, variant, qty }) => ({ cardId, variant, qty })),
    );
    const current = t === tr;
    if (current) t = null;
    tr.done(res, current);
  } catch (e) {
    tr.busy = false;
    tr.error = (e as Error).message;
    drawFoot(tr);
  }
};

export const initColecaoTroca = () => {
  onAction('cx-t-give', (el) => {
    const tr = open();
    const row = tr.rows.find((r) => r.id === el.dataset.id) as TradeRow;
    tr.give.set(row.id, Math.min(row.qty as number, Math.max(0, (tr.give.get(row.id) ?? 0) + Number(el.dataset.d))));
    drawAll(tr);
  });
  onAction('cx-t-get', (el) => {
    const tr = open();
    const g = tr.got[Number(el.dataset.i)] as Got;
    g.qty = Math.min(MAX_QTY, g.qty + Number(el.dataset.d));
    if (g.qty <= 0) tr.got.splice(Number(el.dataset.i), 1);
    drawAll(tr);
  });
  onAction('cx-t-pick', (el) => void pick(el.dataset.id ?? ''));
  onAction('cx-t-go', () => void submit());
  onInput('cx-t-q', (el) => void found((el as HTMLInputElement).value));
  onInput('cx-t-var', (el) => {
    (open().got[Number((el as HTMLElement).dataset.i)] as Got).variant = (el as HTMLSelectElement).value;
  });
};
