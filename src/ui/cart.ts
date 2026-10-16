import { addToCart, cartCount, cartTotals, changeQty, type Destination, needsShipping } from '../domain/cart';
import { brl, escapeHtml as esc } from '../domain/format';
import { quoteCart } from '../domain/shipping';
import { cepDigits, formatCep } from '../domain/validation';
import { cube, emptyState } from './art';
import { $, disabledAttr, onAction, onInput, onSubmit } from './dom';
import { registerView } from './router';
import { persist, S } from './store';
import { toast } from './toast';

export const updateBadge = () => {
  const b = $('#cartCount');
  const n = cartCount(S.cart);
  b.textContent = String(n);
  b.dataset.n = String(n);
};

const shipOption = (o: { name: string; days: string; price: number }, i: number, action: string, pressed: boolean) =>
  `<button class="ship-opt" data-action="${action}" data-i="${i}" aria-pressed="${pressed}"><span><b>${o.name}</b><br><span class="mono muted">${o.days}</span></span><span class="num">${brl(o.price)}</span></button>`;

export const shipOptionsHtml = (
  opts: { name: string; days: string; price: number }[],
  action: string,
  isOn: (i: number) => boolean,
) =>
  `<div class="form-stack" style="gap:8px">${opts.map((o, i) => shipOption(o, i, action, isOn(i))).join('')}<p class="muted" style="font-size:12px">Valores simulados. No site real, vêm do Melhor Envio pelo CEP.</p></div>`;

export const cepForm = (formId: string, inputId: string, label: string, cep: string) =>
  `<form id="${formId}" class="form-stack" novalidate style="gap:10px"><div class="field"><label for="${inputId}">${label}</label><div style="display:flex;gap:8px"><input class="input" id="${inputId}" data-input="cep" inputmode="numeric" maxlength="9" placeholder="00000-000" value="${esc(formatCep(cep))}"><button class="btn btn--ghost" type="submit">calcular</button></div></div><div id="${inputId}-msg" class="muted" style="font-size:13px" role="status"></div></form>`;

const EMPTY = emptyState(
  'carrinho vazio.',
  'Nada por aqui ainda. Comece por uma das duas portas.',
  '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#colecionar" data-action="go" data-view="colecionar">colecionar</a><a class="btn btn--ghost" href="#criar" data-action="go" data-view="criar">criar</a></div>',
  'margin-top:24px',
);

const lineHtml = (l: (typeof S.cart)[number], i: number) => {
  const c = l.color || '#7A8595';
  const dest =
    l.kind === 'item'
      ? `<div class="dest" role="group" aria-label="O que fazer com este item"><button data-action="dest" data-i="${i}" data-v="send" aria-pressed="${l.dest !== 'vault'}">enviar agora</button><button data-action="dest" data-i="${i}" data-v="vault" aria-pressed="${l.dest === 'vault'}">guardar no cofre</button></div>`
      : '';
  return `<div class="line"><div class="thumb ${l.color ? 'c' : 'ph'}" style="--c:${c}">${l.color ? cube(c) : ''}</div><div style="min-width:0"><h3>${esc(l.name)}</h3><p class="mono muted" style="margin-top:4px">${esc(l.sub || '')}</p>${dest}</div><div class="end"><span class="price num">${brl(l.price * l.qty)}</span><div class="qty"><button data-action="qty" data-i="${i}" data-d="-1" aria-label="Diminuir">−</button><span class="num">${l.qty}</span><button data-action="qty" data-i="${i}" data-d="1" aria-label="Aumentar">+</button></div><button class="linkbtn" data-action="remove" data-i="${i}">remover</button></div></div>`;
};

const shippingHtml = (needsShipping: boolean) => {
  if (!needsShipping)
    return '<p class="soft">Tudo vai para o cofre. O frete é calculado quando você pedir o envio.</p>';
  let html = cepForm('formFrete', 'cep', 'calcular frete pelo cep', S.cep);
  if (S.cep) {
    S.shipOpts = quoteCart(S.cep);
    html += shipOptionsHtml(S.shipOpts, 'ship', (i) => S.ship?.name === S.shipOpts[i].name);
  }
  if (S.cart.some((l) => l.dest === 'vault'))
    html +=
      '<p class="muted" style="font-size:13px">Itens marcados para o cofre ficam guardados e não entram neste frete.</p>';
  return html;
};

const PAY_NOTE =
  '<div class="msg" role="status"><b>Fase 2.</b> Aqui o cliente seguiria para o checkout hospedado do Mercado Pago. O pedido só viria como “pago” depois que o Mercado Pago avisar o servidor, e só então os itens marcados para guardar entrariam no cofre. Neste protótipo nenhum pagamento é feito.</div>';

const renderCart = () => {
  const b = $('#cartBody');
  if (!S.cart.length) {
    b.innerHTML = EMPTY;
    return;
  }
  const ship = shippingHtml(needsShipping(S.cart));
  const tot = cartTotals(S.cart, S.ship?.price ?? null);
  const canPay = !tot.needsShipping || !!S.ship;
  const shipLabel = !tot.needsShipping ? 'no cofre' : S.ship ? brl(tot.ship) : 'calcule acima';
  b.innerHTML = `<div class="cart-grid"><div>${S.cart.map(lineHtml).join('')}</div><aside class="summary" aria-label="Resumo">${ship}<div class="sum-row"><span class="soft">subtotal</span><span class="num">${brl(tot.sub)}</span></div><div class="sum-row"><span class="soft">frete</span><span class="num">${shipLabel}</span></div><div class="sum-row total"><span>total</span><span class="num">${brl(tot.total)}</span></div><button class="btn btn--full" data-action="pay"${disabledAttr(!canPay)}>pagar com mercado pago</button>${S.payNote ? PAY_NOTE : ''}</aside></div>`;
};

const changed = () => {
  persist();
  updateBadge();
  renderCart();
};

export const initCart = () => {
  registerView('carrinho', renderCart);
  updateBadge();
  onAction('add', (el) => {
    const r = addToCart(S.cart, el.dataset.id ?? '');
    if (!r.ok) {
      toast(r.error);
      return;
    }
    persist();
    updateBadge();
    toast(`adicionado: ${r.name}`);
  });
  onAction('qty', (el) => {
    const line = S.cart[Number(el.dataset.i)];
    const r = changeQty(line, Number(el.dataset.d));
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
    persist();
    renderCart();
  });
  onAction('ship', (el) => {
    S.ship = S.shipOpts[Number(el.dataset.i)];
    renderCart();
  });
  onAction('pay', () => {
    S.payNote = true;
    renderCart();
  });
  onInput('cep', (el) => {
    const input = el as HTMLInputElement;
    input.value = formatCep(input.value);
  });
  onSubmit('formFrete', () => {
    const c = cepDigits($<HTMLInputElement>('#cep').value);
    if (c.length !== 8) {
      $('#cep-msg').textContent = 'CEP com 8 dígitos, por favor.';
      return;
    }
    S.cep = c;
    S.ship = null;
    renderCart();
  });
};
