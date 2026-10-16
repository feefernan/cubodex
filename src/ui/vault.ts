import { requestShipment, selectedInVault } from '../domain/collection';
import { escapeHtml as esc } from '../domain/format';
import { quoteVault } from '../domain/shipping';
import { cepDigits } from '../domain/validation';
import { emptyState } from './art';
import { cepForm, shipOptionsHtml } from './cart';
import { $, check, disabledAttr, onAction, onInput, onSubmit } from './dom';
import { registerView } from './router';
import { persist, S } from './store';
import { toast } from './toast';

const STATUS = {
  cofre: ['no cofre', 'status ok'],
  envio: ['envio solicitado', 'status'],
  enviado: ['enviado', 'status'],
};

export const loginPrompt = (title: string, text: string, style = '') =>
  emptyState(
    title,
    text,
    '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn" data-action="login-demo">entrar como demo</button><a class="btn btn--ghost" href="#/conta" data-action="go" data-view="conta">ir para a conta</a></div>',
    style,
  );

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
        return `<label class="vrow${on ? '' : ' off'}"><input type="checkbox" data-input="vault-select" data-id="${v.id}"${S.vSel[v.id] ? ' checked' : ''}${on ? '' : ' disabled'} aria-label="Selecionar ${esc(v.name)}"><span class="vph ph"></span><span style="min-width:0"><b style="text-transform:lowercase">${esc(v.name)}</b><br><span class="mono muted">${esc(v.meta)} · ${esc(v.date)} · ${v.qty} un.</span></span><span class="mono ${cls}">${label}</span></label>`;
      })
      .join('') ||
    '<p class="soft" style="padding:14px 0">Nada guardado ainda. No carrinho, escolha “guardar no cofre” nas cartas.</p>';
  const opts =
    S.vCep && units > 0 ? shipOptionsHtml(quoteVault(S.vCep, units), 'vault-ship', (i) => S.vShipIdx === i) : '';
  const ready = units > 0 && S.vShipIdx !== null;
  const hist =
    S.hist.map((h) => `<li><span class="mono muted">${esc(h.d)}</span><br>${esc(h.t)}</li>`).join('') ||
    '<li>sem movimentações</li>';
  const inVault = S.vault.filter((v) => v.st === 'cofre').length;
  b.innerHTML =
    `<div class="vault-grid"><div><div class="section-head" style="margin-bottom:6px"><h2 class="display" style="font-size:28px">seus itens</h2><span class="mono muted">${inVault} no cofre · exemplo</span></div>${rows}` +
    `<div class="section-head" style="margin:36px 0 10px"><h2 class="display" style="font-size:28px">histórico</h2></div><ol class="timeline">${hist}</ol></div>` +
    `<aside class="summary"><h3 class="display" style="font-size:26px">pedir envio</h3><p class="soft">${units ? `${units} un. selecionadas` : 'Marque os itens que quer receber.'}</p>` +
    cepForm('formVFrete', 'vcep', 'cep de entrega', S.vCep) +
    opts +
    `<button class="btn btn--full" data-action="vault-pay"${disabledAttr(!ready)}>pagar frete e pedir envio</button>` +
    '<p class="muted" style="font-size:12px">Neste protótipo o frete não é cobrado. O item sai do estoque à venda na compra, mas continua com a Cubodex até o envio.</p>' +
    '<div class="todo"><b>Decisões em aberto.</b> Envio sem custo junto de uma nova compra, e prazo máximo de guarda com o que acontece depois dele.</div></aside></div>';
};

export const initVault = () => {
  registerView('cofre', renderCofre);
  onInput('vault-select', (el) => {
    S.vSel[el.dataset.id ?? ''] = (el as HTMLInputElement).checked;
    renderCofre();
  });
  onAction('vault-ship', (el) => {
    S.vShipIdx = Number(el.dataset.i);
    renderCofre();
  });
  onAction('vault-pay', () => {
    if (S.vShipIdx === null) return;
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
    S.vCep = c;
    S.vShipIdx = null;
    renderCofre();
  });
};
