import { dexTotals } from '../domain/collection';
import { FEATURES } from '../domain/features';
import { brl, escapeHtml as esc } from '../domain/format';
import { demoAccount } from '../domain/state';
import { api } from '../infra/api';
import { alertMsg, progress } from './cart';
import { dexBar } from './collectibles';
import { $, onAction } from './dom';
import { refresh, registerView } from './router';
import { isRealUser } from './session';
import { persist, S } from './store';
import { toast } from './toast';

const DEMO_LINK =
  '<p style="margin-top:20px"><button class="linkbtn" data-action="login-demo">ver a demonstração</button> <span class="muted" style="font-size:13px">(dados de exemplo, só neste navegador)</span></p>';

const GOOGLE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>';

const LOGGED_OUT = (msg: string) =>
  `<div class="cols-2"><div class="card"><h2>entrar ou criar conta</h2><p class="soft" style="font-size:15px">Sem senha: entre com a sua conta Google. Na primeira vez, a conta da Cubodex é criada com o seu e-mail.</p><div class="form-stack"><a class="btn btn--google" href="/api/auth/google">${GOOGLE_ICON}<span>entrar com Google</span></a><p class="muted" style="font-size:13px">Ao entrar, você aceita os termos de uso e a política de privacidade e autoriza o uso do seu nome e e-mail para pedidos, entrega e para guardar sua Dex e seu cofre.</p><div id="lg-msg" role="status" aria-live="polite">${msg}</div></div></div>` +
  '<div class="card"><h2>por que ter conta</h2><p class="soft">A Dex fica salva em qualquer aparelho, o cofre guarda as cartas que você comprou até pedir o envio, e os pedidos ficam todos num lugar.</p></div></div>' +
  DEMO_LINK;

// Pedidos e endereço de exemplo só na conta de demonstração.
const EXAMPLE_ORDERS =
  '<div class="order-row"><div><b>#1042 · torre de dados</b><br><span class="mono muted">exemplo</span></div><span class="mono status ok">enviado</span></div>' +
  '<div class="order-row"><div><b>#1051 · pacote fiozinho</b><br><span class="mono muted">exemplo</span></div><span class="mono status">pago</span></div>' +
  '<div class="order-row" style="border:0"><div><b>#1057 · charizard holo 1ª edição</b><br><span class="mono muted">exemplo</span></div><span class="mono status">aguardando pagamento</span></div>';

const ordersHtml = () =>
  S.orders.length
    ? S.orders
        .map(
          (o) =>
            `<div class="order-row"><div><b><a href="#/pedido/${esc(o.serial)}" data-action="go" data-view="pedido" data-id="${esc(o.serial)}">${esc(o.serial)}</a> · ${o.kind === 'envio' ? 'envio do cofre' : brl(o.total)}</b><br><span class="mono muted">${esc(o.summary.slice(0, 120))}</span></div><span class="mono status${o.status === 'Pago' ? ' ok' : ''}">${esc(o.status.toLowerCase())}</span></div>`,
        )
        .join('')
    : '<p class="soft">Nenhum pedido ainda.</p>';

const PRIVACY_REAL =
  '<p class="muted" style="font-size:14px">Seus dados (LGPD): baixe uma cópia ou apague a conta. Pedidos pagos continuam registrados para fins fiscais, sem o vínculo com você.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn--ghost btn--sm" href="/api/me/export" download>baixar meus dados</a><button class="btn btn--ghost btn--sm" data-action="delete-account">apagar minha conta</button></div><div id="acc-msg" role="status" aria-live="polite"></div>';

const renderConta = () => {
  const b = $('#contaBody');
  if (!S.user) {
    b.innerHTML = LOGGED_OUT(S.accountMsg);
    return;
  }
  const t = dexTotals(S.dex);
  const inVault = S.vault.filter((v) => v.st === 'cofre').length;
  const demo = !!S.user.demo;
  b.innerHTML =
    `<p class="soft" style="margin-top:8px">Olá, <b style="color:var(--fg)">${esc(S.user.name)}</b>${demo ? ' <span class="mono muted">(demonstração)</span>' : ''}. <button class="linkbtn" data-action="logout">sair</button></p>` +
    `<div class="cols-2"><div class="card"><h3>pedidos</h3>${demo ? EXAMPLE_ORDERS : ordersHtml()}</div>` +
    (FEATURES.colecionaveis
      ? `<div class="card"><h3>minha dex</h3><p class="dex-count num">${t.have}<small>de ${t.total} coletados</small></p>${dexBar(S.dex)}<a class="btn btn--ghost" href="#/dex" data-action="go" data-view="dex">abrir dex</a></div>`
      : '') +
    `<div class="card"><h3>cofre</h3><p class="dex-count num">${inVault}<small>itens guardados</small></p><a class="btn btn--ghost" href="#/cofre" data-action="go" data-view="cofre">abrir cofre</a></div>` +
    `<div class="card"><h3>dados e privacidade</h3><p class="soft">${esc(S.user.email || '')}</p>${demo ? '<p class="muted" style="font-size:14px">A demonstração vive só neste navegador; sair apaga tudo.</p>' : PRIVACY_REAL}</div></div>`;
};

const clearAccount = () => {
  Object.assign(S, { user: null, dex: {}, vault: [], hist: [], orders: [] });
  persist();
};

export const initAccount = () => {
  registerView('conta', () => {
    // #/conta/erro-login: o Google não confirmou a entrada (cancelada, expirada ou e-mail não verificado).
    if (location.hash.endsWith('/erro-login') && !S.user)
      S.accountMsg = alertMsg('Não deu para entrar com o Google. Tente de novo.');
    renderConta();
  });
  onAction('login-demo', () => {
    Object.assign(S, demoAccount(), { orders: [] });
    persist();
    refresh();
    toast('demonstração aberta');
  });
  onAction('logout', async () => {
    if (isRealUser()) await api.logout().catch(() => {});
    // Os dados (de exemplo ou da conta) não ficam para o próximo a usar este navegador.
    clearAccount();
    refresh();
  });
  onAction('delete-account', async () => {
    if (!window.confirm('Apagar sua conta, sua Dex e seu histórico? Isso não pode ser desfeito.')) return;
    const msg = $('#acc-msg');
    msg.innerHTML = progress('apagando…');
    try {
      await api.deleteMe();
      clearAccount();
      S.accountMsg = '<div class="msg"><b>Conta apagada.</b> Obrigado por ter colecionado com a gente.</div>';
      refresh();
    } catch (e) {
      msg.innerHTML = alertMsg((e as Error).message);
    }
  });
};
