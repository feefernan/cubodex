import { dexTotals } from '../domain/collection';
import { brl, escapeHtml as esc } from '../domain/format';
import { demoAccount } from '../domain/state';
import { isEmail } from '../domain/validation';
import { api } from '../infra/api';
import { alertMsg, progress } from './cart';
import { dexBar } from './collectibles';
import { $, check, onAction, onSubmit } from './dom';
import { refresh, registerView } from './router';
import { isRealUser } from './session';
import { persist, S } from './store';
import { toast } from './toast';

const DEMO_LINK =
  '<p style="margin-top:20px"><button class="linkbtn" data-action="login-demo">ver a demonstração</button> <span class="muted" style="font-size:13px">(dados de exemplo, só neste navegador)</span></p>';

const LOGGED_OUT = (msg: string) =>
  `<div class="cols-2"><div class="card"><h2>entrar ou criar conta</h2><p class="soft" style="font-size:15px">Sem senha: mandamos um link para o seu e-mail. Abra no mesmo aparelho.</p><form id="formLogin" class="form-stack" novalidate><div class="field"><label for="lg-email">e-mail</label><input class="input" id="lg-email" type="email" autocomplete="email" placeholder="voce@exemplo.com"></div><label class="check"><input type="checkbox" id="lg-ok"><span>Li os termos de uso e a política de privacidade, e autorizo o uso dos meus dados para pedidos, entrega e para guardar minha Dex e meu cofre. <em class="muted">(texto provisório, a versão final precisa de revisão jurídica — #17)</em></span></label><button class="btn" type="submit">mandar link</button><div id="lg-msg" role="status" aria-live="polite">${msg}</div></form></div>` +
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
    `<div class="card"><h3>minha dex</h3><p class="dex-count num">${t.have}<small>de ${t.total} coletados</small></p>${dexBar(S.dex)}<a class="btn btn--ghost" href="#/dex" data-action="go" data-view="dex">abrir dex</a></div>` +
    `<div class="card"><h3>cofre</h3><p class="dex-count num">${inVault}<small>itens guardados</small></p><a class="btn btn--ghost" href="#/cofre" data-action="go" data-view="cofre">abrir cofre</a></div>` +
    `<div class="card"><h3>dados e privacidade</h3><p class="soft">${esc(S.user.email || '')}</p>${demo ? '<p class="muted" style="font-size:14px">A demonstração vive só neste navegador; sair apaga tudo.</p>' : PRIVACY_REAL}</div></div>`;
};

const clearAccount = () => {
  Object.assign(S, { user: null, dex: {}, vault: [], hist: [], orders: [] });
  persist();
};

export const initAccount = () => {
  registerView('conta', () => {
    // #/conta/link-expirado: o link do e-mail já foi usado ou passou dos 15 minutos.
    if (location.hash.endsWith('/link-expirado') && !S.user)
      S.accountMsg = alertMsg('Esse link já foi usado ou expirou. Peça um novo abaixo.');
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
  onSubmit('formLogin', async (form) => {
    const msg = $('#lg-msg');
    const email = $<HTMLInputElement>('#lg-email');
    const ok = $<HTMLInputElement>('#lg-ok');
    if (!check(email, msg, isEmail(email.value.trim()), alertMsg('Digite um e-mail válido.'))) return;
    const consent = 'O aceite dos termos de uso e da política de privacidade é obrigatório para entrar.';
    if (!check(ok, msg, ok.checked, alertMsg(consent))) return;
    const button = $<HTMLButtonElement>('button[type="submit"]', form);
    button.disabled = true;
    msg.innerHTML = progress('mandando o link…');
    try {
      await api.requestLogin(email.value.trim());
      S.accountMsg = `<div class="msg"><b>Link enviado para ${esc(email.value.trim())}.</b> Abra o e-mail neste aparelho e toque em “entrar”. Vale por 15 minutos.</div>`;
      msg.innerHTML = S.accountMsg;
    } catch (e) {
      msg.innerHTML = alertMsg((e as Error).message);
    } finally {
      button.disabled = false;
    }
  });
};
