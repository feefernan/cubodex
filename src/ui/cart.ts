import {
  addToCart,
  type CartLine,
  cartCount,
  cartTotals,
  changeQty,
  type Destination,
  needsShipping,
  resolveCart,
  toEntry,
} from '../domain/cart';
import { brl, escapeHtml as esc } from '../domain/format';
import { type ShippingOption, shippingDays, shippingLabel } from '../domain/shipping';
import type { BuyerField } from '../domain/state';
import { cepDigits, formatCep, isEmail } from '../domain/validation';
import { api, lookupCep } from '../infra/api';
import { cube, emptyState } from './art';
import { $, check, disabledAttr, onAction, onInput, onSubmit } from './dom';
import { currentView, go, registerView } from './router';
import { persist, S } from './store';
import { toast } from './toast';

/** Saída para o checkout do Mercado Pago (trocável nos testes: o jsdom não navega para fora). */
export const nav = { to: (url: string) => location.assign(url) };

export const updateBadge = () => {
  const b = $('#cartCount');
  const n = cartCount(S.cart);
  // Pulso só quando aumenta: confirma que o item entrou. Reiniciar a classe permite pulsar de novo.
  if (n > Number(b.dataset.n ?? n)) {
    b.classList.remove('bump');
    void b.offsetWidth;
    b.classList.add('bump');
  }
  b.textContent = String(n);
  b.dataset.n = String(n);
};

const shipOption = (o: ShippingOption, i: number, action: string, pressed: boolean) =>
  `<button class="ship-opt" data-action="${action}" data-i="${i}" aria-pressed="${pressed}"><span><b>${esc(shippingLabel(o))}</b><br><span class="mono muted">${shippingDays(o.days)}</span></span><span class="num">${brl(o.price)}</span></button>`;

export const shipOptionsHtml = (opts: ShippingOption[], action: string, isOn: (i: number) => boolean) =>
  `<div class="form-stack" style="gap:8px">${opts.map((o, i) => shipOption(o, i, action, isOn(i))).join('')}<p class="muted" style="font-size:12px">Valores do Melhor Envio para o seu CEP.</p></div>`;

export const cepForm = (formId: string, inputId: string, label: string, cep: string) =>
  `<form id="${formId}" class="form-stack" novalidate style="gap:10px"><div class="field"><label for="${inputId}">${label}</label><div style="display:flex;gap:8px"><input class="input" id="${inputId}" data-input="cep" inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="00000-000" value="${esc(formatCep(cep))}"><button class="btn btn--ghost" type="submit">calcular</button></div></div><div id="${inputId}-msg" class="muted" style="font-size:13px" role="status"></div></form>`;

export const progress = (label: string) => `<p class="mono muted progress-label" role="status">${label}</p>`;
export const alertMsg = (msg: string) => (msg ? `<div class="msg" role="alert">${esc(msg)}</div>` : '');

const EMPTY = emptyState(
  'carrinho vazio.',
  'Nada por aqui ainda. Comece por uma das duas portas.',
  '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#/colecionar" data-action="go" data-view="colecionar">colecionar</a><a class="btn btn--ghost" href="#/criar" data-action="go" data-view="criar">criar</a></div>',
  'margin-top:24px',
);

const lineHtml = (l: CartLine, i: number) => {
  const c = l.color || '#7A8595';
  const dest =
    l.kind === 'item'
      ? `<div class="dest" role="group" aria-label="O que fazer com este item"><button data-action="dest" data-i="${i}" data-v="send" aria-pressed="${l.dest !== 'vault'}">enviar agora</button><button data-action="dest" data-i="${i}" data-v="vault" aria-pressed="${l.dest === 'vault'}">guardar no cofre</button></div>`
      : '';
  return `<div class="line"><div class="thumb ${l.color ? 'c' : 'ph'}" style="--c:${c}">${l.color ? cube(c) : ''}</div><div style="min-width:0"><h3>${esc(l.name)}</h3><p class="mono muted" style="margin-top:4px">${esc(l.sub || '')}</p>${dest}</div><div class="end"><span class="price num">${brl(l.price * l.qty)}</span><div class="qty"><button data-action="qty" data-i="${i}" data-d="-1" aria-label="Diminuir">−</button><span class="num">${l.qty}</span><button data-action="qty" data-i="${i}" data-d="1" aria-label="Aumentar">+</button></div><button class="linkbtn" data-action="remove" data-i="${i}">remover</button></div></div>`;
};

const shippingHtml = (lines: CartLine[]) => {
  if (!needsShipping(lines))
    return '<p class="soft">Tudo vai para o cofre. O frete é calculado quando você pedir o envio.</p>';
  let html = cepForm('formFrete', 'cep', 'calcular frete pelo cep', S.cep);
  if (S.quoting) html += progress('calculando frete…');
  else if (S.quoteError) html += alertMsg(S.quoteError);
  else if (S.shipOpts.length) html += shipOptionsHtml(S.shipOpts, 'ship', (i) => S.ship?.id === S.shipOpts[i].id);
  if (lines.some((l) => l.dest === 'vault'))
    html +=
      '<p class="muted" style="font-size:13px">Itens marcados para o cofre ficam guardados e não entram neste frete.</p>';
  return html;
};

const field = (name: BuyerField, label: string, attrs: string, full = false) =>
  `<div class="field${full ? ' full' : ''}"><label for="ck-${name}">${label}</label><input class="input" id="ck-${name}" name="${name}" data-input="buyer" ${attrs} value="${esc(S.buyer[name])}"></div>`;

/** Campos de endereço (checkout e envio do cofre), preenchidos pelo ViaCEP quando possível. */
export const addressFields = (cep: string) =>
  `<p class="mono muted full">entrega no CEP ${esc(formatCep(cep))}</p>${field('street', 'rua', 'autocomplete="address-line1" maxlength="200"', true)}${field('number', 'número', 'inputmode="numeric" maxlength="20"')}${field('complement', 'complemento', 'autocomplete="address-line2" maxlength="100"')}${field('district', 'bairro', 'maxlength="100"')}${field('city', 'cidade', 'autocomplete="address-level2" maxlength="100"')}${field('uf', 'UF', 'autocomplete="address-level1" maxlength="2"')}`;

const checkoutForm = (shipped: boolean) =>
  `<form id="formCheckout" class="form-grid" novalidate style="gap:10px"><h3 class="display full" style="font-size:24px">seus dados</h3>${field('name', 'nome', 'autocomplete="name" maxlength="120"', true)}${field('email', 'e-mail', 'type="email" autocomplete="email" maxlength="200"', true)}${
    shipped ? addressFields(S.cep) : ''
  }<div class="full">${
    S.paying
      ? `<button class="btn btn--full" type="submit" disabled>registrando pedido…</button>`
      : '<button class="btn btn--full" type="submit">pagar com mercado pago</button>'
  }</div><div class="full" id="ck-msg" role="status" aria-live="polite">${alertMsg(S.payError)}</div><p class="muted full" style="font-size:12px">O pagamento (Pix ou cartão) acontece no site do Mercado Pago. Os itens do cofre só entram nele depois do pagamento confirmado.</p></form>`;

/**
 * Confere o carrinho salvo contra o catálogo atual: item que sumiu ou esgotou sai (com aviso) e a
 * quantidade nunca passa do estoque. Devolve as linhas prontas para mostrar.
 */
const syncCart = (): CartLine[] => {
  const { lines, dropped } = resolveCart(S.cart);
  const entries = lines.map(toEntry);
  if (dropped || JSON.stringify(entries) !== JSON.stringify(S.cart)) {
    S.cart = entries;
    persist();
    updateBadge();
    if (dropped)
      toast(dropped === 1 ? 'um item esgotou e saiu do carrinho' : `${dropped} itens esgotaram e saíram do carrinho`);
  }
  return lines;
};

const renderCart = () => {
  const b = $('#cartBody');
  const lines = syncCart();
  if (!lines.length) {
    b.innerHTML = EMPTY;
    return;
  }
  const tot = cartTotals(lines, S.ship?.price ?? null);
  const ready = !tot.needsShipping || !!S.ship;
  const shipLabel = !tot.needsShipping ? 'no cofre' : S.ship ? brl(tot.ship) : 'calcule acima';
  const action = S.checkout
    ? checkoutForm(tot.needsShipping)
    : `<button class="btn btn--full" data-action="checkout-open"${disabledAttr(!ready)}>finalizar compra</button>`;
  b.innerHTML = `<div class="cart-grid"><div>${lines.map(lineHtml).join('')}</div><aside class="summary" aria-label="Resumo">${shippingHtml(lines)}<div class="sum-row"><span class="soft">subtotal</span><span class="num">${brl(tot.sub)}</span></div><div class="sum-row"><span class="soft">frete</span><span class="num">${shipLabel}</span></div><div class="sum-row total"><span>total</span><span class="num">${brl(tot.total)}</span></div>${action}</aside></div>`;
};

const renderIfOpen = () => {
  if (currentView() === 'carrinho') renderCart();
};

/** Cota o frete de novo (CEP novo ou carrinho mudou): o preço depende do que vai na caixa. */
const requote = async () => {
  const lines = resolveCart(S.cart).lines;
  S.ship = null;
  S.shipOpts = [];
  S.quoteError = '';
  if (!S.cep || !needsShipping(lines)) {
    renderIfOpen();
    return;
  }
  S.quoting = true;
  renderIfOpen();
  try {
    S.shipOpts = await api.quote(S.cep, S.cart);
  } catch (e) {
    S.quoteError = (e as Error).message;
  } finally {
    S.quoting = false;
    renderIfOpen();
  }
};

const changed = () => {
  persist();
  updateBadge();
  S.checkout = false;
  if (S.cep) void requote();
  else renderCart();
};

/** Abre o checkout: nome e e-mail da conta e endereço do CEP já preenchidos quando possível. */
const openCheckout = async () => {
  S.checkout = true;
  S.payError = '';
  if (S.user && !S.buyer.name) S.buyer.name = S.user.name;
  if (S.user && !S.buyer.email) S.buyer.email = S.user.email;
  renderCart();
  if (S.cep && !S.buyer.street) {
    const found = await lookupCep(S.cep);
    if (found) Object.assign(S.buyer, found);
    renderIfOpen();
  }
  document.getElementById(S.buyer.name ? 'ck-number' : 'ck-name')?.focus();
};

const REQUIRED: [BuyerField, string][] = [
  ['name', 'Digite seu nome.'],
  ['street', 'Digite a rua.'],
  ['number', 'Digite o número.'],
  ['city', 'Digite a cidade.'],
  ['uf', 'Digite a UF (2 letras).'],
];

/** Confere os campos visíveis do comprador, marcando o primeiro com erro; false = parar. */
export const buyerValid = (fields: BuyerField[], msg: HTMLElement): boolean => {
  const b = S.buyer;
  for (const [k, text] of REQUIRED) {
    if (!fields.includes(k)) continue;
    const ok = k === 'uf' ? /^[A-Za-z]{2}$/.test(b.uf.trim()) : b[k].trim().length > (k === 'name' ? 1 : 0);
    if (!check($(`#ck-${k}`), msg, ok, alertMsg(text))) return false;
  }
  return (
    !fields.includes('email') ||
    check($('#ck-email'), msg, isEmail(b.email.trim()), alertMsg('Digite um e-mail válido.'))
  );
};

export const ADDRESS_FIELDS: BuyerField[] = ['street', 'number', 'city', 'uf'];

/** Endereço do comprador no formato da API. */
export const buyerAddress = (cep: string) => ({
  cep,
  street: S.buyer.street.trim(),
  number: S.buyer.number.trim(),
  complement: S.buyer.complement.trim(),
  district: S.buyer.district.trim(),
  city: S.buyer.city.trim(),
  uf: S.buyer.uf.trim().toUpperCase(),
});

const submitOrder = async () => {
  const shipped = needsShipping(resolveCart(S.cart).lines);
  const b = S.buyer;
  if (!buyerValid(['name', ...(shipped ? ADDRESS_FIELDS : []), 'email'], $('#ck-msg'))) return;

  S.paying = true;
  S.payError = '';
  renderCart();
  try {
    const order = await api.order({
      items: S.cart,
      customer: { name: b.name.trim(), email: b.email.trim() },
      address: shipped ? buyerAddress(S.cep) : null,
      shipping: shipped && S.ship ? { serviceId: S.ship.id } : null,
    });
    S.paying = false;
    S.checkout = false;
    // O carrinho só esvazia quando o pagamento for confirmado (página do pedido).
    if (order.checkoutUrl) nav.to(order.checkoutUrl);
    else go('pedido', order.serial);
  } catch (e) {
    S.paying = false;
    S.payError = (e as Error).message;
    renderIfOpen();
  }
};

export const initCart = () => {
  registerView('carrinho', renderCart);
  syncCart();
  updateBadge();
  onAction('add', (el) => {
    const r = addToCart(S.cart, el.dataset.id ?? '');
    if (!r.ok) {
      toast(r.error);
      return;
    }
    persist();
    updateBadge();
    S.ship = null;
    S.shipOpts = [];
    toast(`adicionado: ${r.name}`);
  });
  onAction('qty', (el) => {
    const r = changeQty(S.cart[Number(el.dataset.i)], Number(el.dataset.d));
    if (!r.ok) toast(r.error);
    else changed();
  });
  onAction('remove', (el) => {
    S.cart.splice(Number(el.dataset.i), 1);
    changed();
  });
  onAction('dest', (el) => {
    const line = S.cart[Number(el.dataset.i)];
    if (!line) return;
    line.dest = el.dataset.v as Destination;
    changed();
  });
  onAction('ship', (el) => {
    S.ship = S.shipOpts[Number(el.dataset.i)] ?? null;
    renderCart();
  });
  onAction('checkout-open', () => void openCheckout());
  onInput('buyer', (el) => {
    const input = el as HTMLInputElement;
    S.buyer[input.name as BuyerField] = input.value;
  });
  onInput('cep', (el) => {
    const input = el as HTMLInputElement;
    input.value = formatCep(input.value);
  });
  onSubmit('formFrete', () => {
    const c = cepDigits($<HTMLInputElement>('#cep').value);
    if (!check($('#cep'), $('#cep-msg'), c.length === 8, 'CEP com 8 dígitos, por favor.')) return;
    if (c !== S.cep) Object.assign(S.buyer, { street: '', district: '', city: '', uf: '' });
    S.cep = c;
    void requote();
  });
  onSubmit('formCheckout', () => void submitOrder());
};

/** Pagamento confirmado: o carrinho esvazia. */
export const clearCart = () => {
  S.cart = [];
  S.ship = null;
  S.shipOpts = [];
  persist();
  updateBadge();
};
