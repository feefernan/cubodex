import { type CardRef, ITEMS, type Item, itemName, PACK, type Product, photoUrl } from '../domain/catalog';
import { cardImageUrl } from '../domain/enciclopedia';
import { brl, escapeHtml as esc, pad3 } from '../domain/format';
import { cube, flag, plan } from './art';
import { disabledAttr } from './dom';

/**
 * Imagem da carta numa grade: a foto própria do item (R2) tem prioridade; sem ela, a imagem oficial do TCGdex.
 * O nome vem do link em volta, então a imagem é decorativa.
 */
const cardImg = (c: CardRef, lang: string, own?: string) => {
  const src = own ? photoUrl(own) : c.image ? cardImageUrl(c.image, 'low', lang === 'PT' && c.pt ? 'pt' : 'en') : '';
  return src ? `<img src="${esc(src)}" alt="" width="245" height="337" loading="lazy" decoding="async">` : '';
};

/** Miniatura da carta de um item (para o cofre); vazia se o item saiu do catálogo. */
export const itemImg = (id?: string) => {
  const it = ITEMS.find((i) => i.id === id);
  return it ? cardImg(it.card, it.lang, it.photos?.[0]) : '';
};

/** Foto própria do produto, preenchendo o espaço da mídia. */
const photoImg = (p: Product, key: string, alt = p.name) =>
  `<img class="photo" src="${photoUrl(key)}" alt="${esc(alt)}" width="400" height="400" loading="lazy" decoding="async">`;

/** Selados e acessórios com mais de uma foto (até 3): faixa que se desliza, com um ponto por foto. */
const gallery = (p: Product, keys: string[]): string => {
  const shots = keys.slice(0, 3);
  const imgs = shots.map((k, i) => photoImg(p, k, `${p.name} (foto ${i + 1} de ${shots.length})`)).join('');
  const dots = shots.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('');
  return `<div class="media media--sq media--shelf gallery"><div class="gallery-track" tabindex="0" role="region" aria-label="Fotos de ${esc(p.name)}">${imgs}</div><div class="gallery-dots" aria-hidden="true">${dots}</div></div>`;
};

const gradeChip = (it: Item) => (it.grade ? `<span class="mono grade">${esc(it.grade.co)} ${it.grade.n}</span>` : '');

const addButton = (id: string) => `<button class="btn btn--sm" data-action="add" data-id="${id}">adicionar</button>`;
const soldOutButton = `<button class="btn btn--sm"${disabledAttr(true)}>esgotado</button>`;

const media = (p: Product): string => {
  const own = p.photos?.[0];
  if (own && p.kind === 'acc' && (p.photos?.length ?? 0) > 1) return gallery(p, p.photos ?? []);
  if (own && p.kind !== 'item')
    return `<div class="media media--${p.kind === 'craft' ? 'craft' : 'sq'}${p.kind === 'acc' ? ' media--shelf' : ''}">${photoImg(p, own)}</div>`;
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

const accDetails = (p: Extract<Product, { kind: 'acc' }>): string => {
  const qty = p.qty === undefined ? '' : `<p class="mono qty-un num">${p.qty} un.</p>`;
  if (p.group !== 'lacrado') {
    const kind = [p.subtype, p.color].filter(Boolean).map(esc).join(' · ');
    return `${kind ? `<p class="mono muted">${kind}</p>` : ''}<p class="mono meta">${esc(p.note)}</p>${qty}`;
  }
  const set = p.set ? `<p class="mono muted">${esc(p.set)}</p>` : '';
  const sub = p.subtype ? `<span class="mono pill">${esc(p.subtype)}</span>` : '';
  const lang = p.lang || sub ? `<div class="badges">${p.lang ? flag(p.lang) : ''}${sub}</div>` : '';
  return `${set}${lang}<p class="mono meta">${esc(p.note)}</p>${qty}`;
};

const details = (p: Product): string => {
  if (p.kind === 'acc') return accDetails(p);
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
  const soldOut = p.kind === 'acc' && p.qty === 0;
  return `<article class="tile${soldOut ? ' soldout' : ''}">${media(p)}<div class="body"><h3>${esc(p.name)}</h3>${details(p)}<div class="row"><span class="price num">${brl(p.price)}</span><div class="actions">${pack}${soldOut ? soldOutButton : addButton(p.id)}</div></div></div></article>`;
};

export const fillProducts = (container: HTMLElement, products: Product[]) => {
  container.innerHTML = products.map(productTile).join('');
};

const cardLink = (c: CardRef, inner: string, cls: string, label: string) =>
  `<a class="${cls}" href="#/carta/${esc(c.id)}" data-action="go" data-view="carta" data-id="${esc(c.id)}" aria-label="${label}">${inner}</a>`;

/** Card de um item de TCG à venda. */
export const itemTile = (it: Item): string => {
  const c = it.card;
  const soldOut = it.status === 'esgotado';
  const tag = soldOut
    ? '<span class="state-tag">esgotado</span>'
    : it.status === 'prevenda'
      ? '<span class="state-tag pre">pré-venda</span>'
      : '';
  const name = esc(itemName(it));
  return `<article class="tile${soldOut ? ' soldout' : ''}">${cardLink(c, `${tag}${cardImg(c, it.lang, it.photos?.[0])}`, 'media media--card', `Ver a carta ${name}`)}<div class="body"><h3><a href="#/carta/${esc(c.id)}" data-action="go" data-view="carta" data-id="${esc(c.id)}" style="text-decoration:none">${name}</a></h3><p class="mono muted">${esc(c.setName)}</p><div class="badges">${flag(it.lang)}<span class="mono pill">${esc(it.variant)}</span>${gradeChip(it)}</div><p class="mono qty-un num">${soldOut ? 0 : it.qty} un.</p><div class="row"><span class="price num">${brl(it.price)}</span>${soldOut ? soldOutButton : addButton(it.id)}</div></div></article>`;
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
