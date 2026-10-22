import {
  type Card,
  cardById,
  cardImage,
  type Item,
  itemName,
  PACK,
  type Product,
  photoUrl,
  setById,
} from '../domain/catalog';
import { brl, escapeHtml as esc, pad3 } from '../domain/format';
import { itemsOfCard } from '../domain/tcg';
import { cube, flag, plan } from './art';
import { disabledAttr } from './dom';

/**
 * Imagem da carta numa grade: a foto própria do item (R2) tem prioridade; sem ela, a imagem oficial do TCGdex.
 * O nome vem do link em volta, então a imagem é decorativa.
 */
const cardImg = (c: Card, lang?: string, own?: string) =>
  `<img src="${own ? photoUrl(own) : cardImage(c, lang)}" alt="" width="245" height="337" loading="lazy" decoding="async">`;

/** Foto própria do produto, preenchendo o espaço da mídia. */
const photoImg = (p: Product, key: string) =>
  `<img class="photo" src="${photoUrl(key)}" alt="${esc(p.name)}" width="400" height="400" loading="lazy" decoding="async">`;

const gradeChip = (it: Item) => (it.grade ? `<span class="mono grade">${esc(it.grade.co)} ${it.grade.n}</span>` : '');

const addButton = (id: string) => `<button class="btn btn--sm" data-action="add" data-id="${id}">adicionar</button>`;
const soldOutButton = `<button class="btn btn--sm"${disabledAttr(true)}>esgotado</button>`;

const media = (p: Product): string => {
  const own = p.photos?.[0];
  if (own && p.kind !== 'item')
    return `<div class="media media--${p.kind === 'craft' ? 'craft' : 'sq'}">${photoImg(p, own)}</div>`;
  switch (p.kind) {
    case 'acc':
      // shortcut: acessórios ainda sem foto (#15); o campo liso guarda o lugar até a foto chegar.
      return '<div class="media media--sq ph" aria-hidden="true"></div>';
    case 'mini':
      return `<div class="media media--mini" style="--c:${p.color}"><span class="mono num-tag">#${pad3(p.n)}</span>${cube(p.color)}</div>`;
    case 'craft':
      return `<div class="media media--craft">${plan(p.spec.find(([k]) => k === 'medidas')?.[1] ?? '')}</div>`;
    default:
      return '';
  }
};

const details = (p: Product): string => {
  if (p.kind === 'acc') return `<p class="mono meta">${esc(p.note)}</p>`;
  if (p.kind === 'mini') return `<p class="mono muted">${esc(p.rar)} · série 01</p>`;
  if (p.kind === 'craft')
    return `<dl class="spec">${p.spec.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  return '';
};

/** Card de acessório, peça de "criar" ou miniatura. */
export const productTile = (p: Product): string => {
  const pack =
    p.kind === 'mini' && PACK.listed
      ? `<button class="btn btn--ghost btn--sm" data-action="pack-add" data-id="${p.id}">+ pacote</button>`
      : '';
  return `<article class="tile">${media(p)}<div class="body"><h3>${esc(p.name)}</h3>${details(p)}<div class="row"><span class="price num">${brl(p.price)}</span><div class="actions">${pack}${addButton(p.id)}</div></div></div></article>`;
};

export const fillProducts = (container: HTMLElement, products: Product[]) => {
  container.innerHTML = products.map(productTile).join('');
};

const cardLink = (c: Card, inner: string, cls: string, label: string) =>
  `<a class="${cls}" href="#/carta/${c.id}" data-action="go" data-view="carta" data-id="${c.id}" aria-label="${label}">${inner}</a>`;

/** Card de um item de TCG à venda. */
export const itemTile = (it: Item): string => {
  const c = cardById[it.card];
  const soldOut = it.status === 'esgotado';
  const tag = soldOut
    ? '<span class="state-tag">esgotado</span>'
    : it.status === 'prevenda'
      ? '<span class="state-tag pre">pré-venda</span>'
      : '';
  const name = esc(itemName(it));
  return `<article class="tile${soldOut ? ' soldout' : ''}">${cardLink(c, `${tag}${cardImg(c, it.lang, it.photos?.[0])}`, 'media media--card', `Ver a carta ${name}`)}<div class="body"><h3><a href="#/carta/${c.id}" data-action="go" data-view="carta" data-id="${c.id}" style="text-decoration:none">${name}</a></h3><p class="mono muted">${esc(setById[c.set].name)}</p><div class="badges">${flag(it.lang)}<span class="mono pill">${esc(it.variant)}</span>${gradeChip(it)}</div><p class="mono qty-un num">${soldOut ? 0 : it.qty} un.</p><div class="row"><span class="price num">${brl(it.price)}</span>${soldOut ? soldOutButton : addButton(it.id)}</div></div></article>`;
};

/** Linha de venda na página da carta. */
export const saleRow = (it: Item): string => {
  const soldOut = it.status === 'esgotado';
  const status = soldOut
    ? '<span class="mono status">esgotado</span>'
    : it.status === 'prevenda'
      ? '<span class="mono status ok">pré-venda</span>'
      : '';
  return `<div class="sale-row"><div class="badges">${flag(it.lang)}<span class="mono pill">${esc(it.variant)}</span>${gradeChip(it)}${status}</div><span class="mono qty-un num">${soldOut ? 0 : it.qty} un.</span><span class="price num">${brl(it.price)}</span>${soldOut ? soldOutButton : addButton(it.id)}</div>`;
};

/** Card de uma carta da enciclopédia (com ou sem item à venda). */
export const cardTile = (c: Card): string => {
  const its = itemsOfCard(c.id);
  const hit = its.length > 0;
  const min = hit ? Math.min(...its.map((i) => i.price)) : 0;
  const name = esc(c.name);
  const row = hit
    ? `<span class="mono tag">a partir de ${brl(min)}</span><a class="btn btn--sm" href="#/carta/${c.id}" data-action="go" data-view="carta" data-id="${c.id}">comprar</a>`
    : '<span class="mono muted">sem item à venda</span>';
  return `<article class="tile${hit ? ' hit' : ''}">${cardLink(c, cardImg(c), 'media media--card', `Ver ${name}`)}<div class="body"><span class="mono muted num">${c.n}/${setById[c.set].total}</span><h3><a href="#/carta/${c.id}" data-action="go" data-view="carta" data-id="${c.id}" style="text-decoration:none">${name}</a></h3><p class="mono muted">${esc(c.rar)} · ${esc(c.tipo)}</p><div class="row">${row}</div></div></article>`;
};
