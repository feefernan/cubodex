import { requestShipment, selectedInVault } from '../domain/collection';
import { escapeHtml as esc } from '../domain/format';
import type { ShippingOption } from '../domain/shipping';
import { cepDigits } from '../domain/validation';
import { api, lookupCep } from '../infra/api';
import { emptyState } from './art';
import {
  ADDRESS_FIELDS,
  addressFields,
  alertMsg,
  buyerAddress,
  buyerValid,
  cepForm,
  contactFields,
  nav,
  progress,
  shipOptionsHtml,
} from './cart';
import { $, check, disabledAttr, onAction, onInput, onSubmit } from './dom';
import { currentView, registerView } from './router';
import { isRealUser } from './session';
import { persist, S } from './store';
import { itemImg } from './tiles';
import { toast } from './toast';

// Demonstração: frete simulado e sem cobrança (conta real cota no Melhor Envio e paga no Mercado Pago).
const demoQuote = (cep: string, units: number): ShippingOption[] => {
  const d = Number.parseInt(cep.charAt(0), 10) || 0;
  const price = (base: number, perCep: number) => Math.round((base + d * perCep + units * 1.5) * 100) / 100;
  return [
    { id: 1, name: 'econômico (simulado)', company: '', price: price(12.9, 1.1), days: 9 },
    { id: 2, name: 'expresso (simulado)', company: '', price: price(25.5, 1.6), days: 4 },
  ];
};

const STATUS = {
  cofre: ['no cofre', 'status ok'],
  envio: ['envio solicitado', 'status'],
  enviado: ['enviado', 'status'],
};

export const loginPrompt = (title: string, text: string, style = '') =>
  emptyState(
    title,
    text,
    '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#/conta" data-action="go" data-view="conta">entrar</a><button class="btn btn--ghost" data-action="login-demo">ver a demonstração</button></div>',
    style,
  );

/** Painel "pedir envio": CEP → opções → (conta real) endereço → pagar. */
const shipPanel = (units: number) => {
  const real = isRealUser();
  const opts = real ? S.vOpts : S.vCep && units > 0 ? demoQuote(S.vCep, units) : [];
  const ready = units > 0 && S.vShipIdx !== null && !S.vBusy;
  let html = cepForm('formVFrete', 'vcep', 'cep de entrega', S.vCep);
  if (S.vBusy) html += progress(S.vBusy);
  html += alertMsg(S.vError);
  if (opts.length && units > 0) html += shipOptionsHtml(opts, 'vault-ship', (i) => S.vShipIdx === i);
  if (real && S.vShipIdx !== null && units > 0)
    html += `<div class="form-grid" style="gap:10px">${contactFields('vk')}${addressFields(S.vCep, 'vk')}</div><div id="vk-msg" role="status" aria-live="polite"></div>`;
  html += `<button class="btn btn--full" data-action="vault-pay"${disabledAttr(!ready)}>pagar frete e pedir envio</button>`;
  html += real
    ? '<p class="muted" style="font-size:12px">O frete é pago no Mercado Pago. Os itens saem do cofre quando o pagamento confirmar.</p>'
    : '<p class="muted" style="font-size:12px">Demonstração: o frete é simulado e nada é cobrado.</p>';
  return html;
};

const renderCofre = () => {
  const b = $('#cofreBody');
  if (!S.user) {
    b.innerHTML = loginPrompt(
      'entre para abrir o cofre.',
      'O cofre fica ligado à sua conta. Entre para ver os itens guardados.',
      'margin-top:20px',
    );
    return;
  }
  const units = selectedInVault(S.vault, S.vSel).reduce((a, v) => a + v.qty, 0);
  const rows =
    S.vault
      .map((v) => {
        const on = v.st === 'cofre';
        const [label, cls] = STATUS[v.st];
        return `<label class="vrow${on ? '' : ' off'}"><input type="checkbox" data-input="vault-select" data-id="${esc(v.id)}"${S.vSel[v.id] ? ' checked' : ''}${on ? '' : ' disabled'} aria-label="Selecionar ${esc(v.name)}"><span class="vph ph">${itemImg(v.productId)}</span><span style="min-width:0"><b style="text-transform:lowercase">${esc(v.name)}</b><br><span class="mono muted">${esc(v.meta)} · ${esc(v.date)} · ${v.qty} un.</span></span><span class="mono ${cls}">${label}</span></label>`;
      })
      .join('') ||
    '<p class="soft" style="padding:14px 0">Nada guardado ainda. No carrinho, escolha “guardar no cofre” nas cartas.</p>';
  const hist =
    S.hist.map((h) => `<li><span class="mono muted">${esc(h.d)}</span><br>${esc(h.t)}</li>`).join('') ||
    '<li>sem movimentações</li>';
  const inVault = S.vault.filter((v) => v.st === 'cofre').length;
  b.innerHTML =
    `<div class="vault-grid"><div><div class="section-head" style="margin-bottom:6px"><h2 class="display" style="font-size:28px">seus itens</h2><span class="mono muted">${inVault} no cofre${S.user.demo ? ' · exemplo' : ''}</span></div>${rows}` +
    `<div class="section-head" style="margin:36px 0 10px"><h2 class="display" style="font-size:28px">histórico</h2></div><ol class="timeline">${hist}</ol></div>` +
    `<aside class="summary"><h3 class="display" style="font-size:26px">pedir envio</h3><p class="soft">${units ? `${units} un. selecionada${units > 1 ? 's' : ''}` : 'Marque os itens que quer receber.'}</p>` +
    shipPanel(units) +
    '</aside></div>';
};

const renderIfOpen = () => {
  if (currentView() === 'cofre') renderCofre();
};

/** Conta real: cota o envio dos itens marcados no Melhor Envio (pela API) e preenche o endereço pelo CEP. */
const quoteVault = async () => {
  const chosen = selectedInVault(S.vault, S.vSel);
  S.vOpts = [];
  S.vShipIdx = null;
  S.vError = '';
  if (!chosen.length) return renderIfOpen();
  S.vBusy = 'calculando frete…';
  renderIfOpen();
  try {
    const [opts, found] = await Promise.all([
      api.quote(
        S.vCep,
        chosen.map((v) => ({ id: v.productId ?? '', qty: v.qty })),
        true,
      ),
      S.buyer.street ? null : lookupCep(S.vCep),
    ]);
    S.vOpts = opts;
    if (found) Object.assign(S.buyer, found);
  } catch (e) {
    S.vError = (e as Error).message;
  } finally {
    S.vBusy = '';
    renderIfOpen();
  }
};

const payVault = async () => {
  const chosen = selectedInVault(S.vault, S.vSel);
  const option = S.vOpts[S.vShipIdx ?? -1];
  if (!chosen.length || !option || !buyerValid(['cpf', 'phone', ...ADDRESS_FIELDS], $('#vk-msg'), 'vk')) return;
  S.vBusy = 'registrando o envio…';
  S.vError = '';
  renderCofre();
  try {
    const res = await api.shipVault({
      items: chosen.map((v) => v.id),
      address: buyerAddress(S.vCep),
      contact: { cpf: S.buyer.cpf, phone: S.buyer.phone },
      shipping: { serviceId: option.id },
    });
    nav.to(res.checkoutUrl);
  } catch (e) {
    S.vError = (e as Error).message;
  } finally {
    S.vBusy = '';
    renderIfOpen();
  }
};

export const initVault = () => {
  registerView('cofre', renderCofre);
  onInput('vault-select', (el) => {
    S.vSel[el.dataset.id ?? ''] = (el as HTMLInputElement).checked;
    if (isRealUser() && S.vCep) void quoteVault();
    else {
      S.vShipIdx = null;
      renderCofre();
    }
  });
  onAction('vault-ship', (el) => {
    S.vShipIdx = Number(el.dataset.i);
    renderCofre();
  });
  onAction('vault-pay', () => {
    if (S.vShipIdx === null) return;
    if (isRealUser()) {
      void payVault();
      return;
    }
    const date = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    if (!requestShipment(S.vault, S.hist, S.vSel, date)) return;
    S.vSel = {};
    S.vShipIdx = null;
    persist();
    renderCofre();
    toast('pedido de envio criado (simulado)');
  });
  onSubmit('formVFrete', () => {
    const c = cepDigits($<HTMLInputElement>('#vcep').value);
    if (!check($('#vcep'), $('#vcep-msg'), c.length === 8, 'CEP com 8 dígitos, por favor.')) return;
    if (c !== S.vCep) Object.assign(S.buyer, { street: '', district: '', city: '', uf: '' });
    S.vCep = c;
    S.vShipIdx = null;
    if (isRealUser()) void quoteVault();
    else renderCofre();
  });
};
