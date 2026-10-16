import { dexTotals } from '../domain/collection';
import { escapeHtml as esc } from '../domain/format';
import { DEMO_USER } from '../domain/state';
import { isEmail } from '../domain/validation';
import { dexBar } from './collectibles';
import { $, onAction, onSubmit } from './dom';
import { refresh, registerView } from './router';
import { persist, S } from './store';
import { toast } from './toast';

const LOGGED_OUT =
  '<div class="cols-2"><div class="card"><h2>entrar</h2><form id="formLogin" class="form-stack" novalidate><div class="field"><label for="lg-email">e-mail</label><input class="input" id="lg-email" type="email" autocomplete="email" placeholder="voce@exemplo.com"></div><div class="field"><label for="lg-pass">senha</label><input class="input" id="lg-pass" type="password" autocomplete="current-password" placeholder="qualquer valor neste protótipo"></div><button class="btn" type="submit">entrar</button><p class="muted" style="font-size:13px">Protótipo: nada é enviado nem salvo fora deste navegador.</p></form></div>' +
  '<div class="card"><h2>criar conta</h2><form id="formCadastro" class="form-stack" novalidate><div class="field"><label for="cd-nome">nome</label><input class="input" id="cd-nome" type="text" autocomplete="name"></div><div class="field"><label for="cd-email">e-mail</label><input class="input" id="cd-email" type="email" autocomplete="email"></div><label class="check"><input type="checkbox" id="cd-ok"><span>Li os termos de uso e a política de privacidade, e autorizo o uso dos meus dados para pedidos e entrega. <em class="muted">(texto provisório, a versão final precisa de revisão jurídica)</em></span></label><button class="btn" type="submit">criar conta</button><div id="cd-msg" role="status" aria-live="polite"></div></form></div></div>' +
  '<p style="margin-top:20px"><button class="linkbtn" data-action="login-demo">entrar como demo</button></p>';

// shortcut: pedidos e endereço fixos de exemplo até existir backend (#20).
const EXAMPLE_ORDERS =
  '<div class="order-row"><div><b>#1042 · torre de dados</b><br><span class="mono muted">exemplo</span></div><span class="mono status ok">enviado</span></div>' +
  '<div class="order-row"><div><b>#1051 · pacote fiozinho</b><br><span class="mono muted">exemplo</span></div><span class="mono status">pago</span></div>' +
  '<div class="order-row" style="border:0"><div><b>#1057 · charizard holo 1ª edição</b><br><span class="mono muted">exemplo</span></div><span class="mono status">aguardando pagamento</span></div>';

const renderConta = () => {
  const b = $('#contaBody');
  if (!S.user) {
    b.innerHTML = LOGGED_OUT;
    return;
  }
  const t = dexTotals(S.dex);
  const inVault = S.vault.filter((v) => v.st === 'cofre').length;
  b.innerHTML =
    `<p class="soft" style="margin-top:8px">Olá, <b style="color:var(--fg)">${esc(S.user.name)}</b>. <button class="linkbtn" data-action="logout">sair</button></p>` +
    `<div class="cols-2"><div class="card"><h3>pedidos</h3>${EXAMPLE_ORDERS}</div>` +
    `<div class="card"><h3>minha dex</h3><p class="dex-count num">${t.have}<small>de ${t.total} coletados</small></p>${dexBar(S.dex)}<a class="btn btn--ghost" href="#dex" data-action="go" data-view="dex">abrir dex</a></div>` +
    `<div class="card"><h3>cofre</h3><p class="dex-count num">${inVault}<small>itens guardados</small></p><a class="btn btn--ghost" href="#cofre" data-action="go" data-view="cofre">abrir cofre</a></div>` +
    '<div class="card"><h3>endereços</h3><p class="soft">Rua Exemplo, 123 · apto 45<br>São Paulo / SP · CEP 01000-000</p><span class="mono muted">endereço de exemplo</span></div>' +
    `<div class="card"><h3>dados e privacidade</h3><p class="soft">${esc(S.user.email || '')}</p><p class="muted" style="font-size:14px">Aqui o cliente pede cópia ou exclusão dos dados (LGPD). Tela a definir com apoio jurídico.</p></div></div>`;
};

export const initAccount = () => {
  registerView('conta', renderConta);
  onAction('login-demo', () => {
    S.user = { ...DEMO_USER };
    persist();
    refresh();
    toast('entrou como demo');
  });
  onAction('logout', () => {
    S.user = null;
    persist();
    refresh();
  });
  // shortcut: login sem senha de verdade, só no navegador — contas reais em #20.
  onSubmit('formLogin', () => {
    const email = $<HTMLInputElement>('#lg-email').value.trim();
    S.user = { name: email ? email.split('@')[0] : DEMO_USER.name, email: email || DEMO_USER.email };
    persist();
    renderConta();
    toast('você entrou');
  });
  onSubmit('formCadastro', () => {
    const email = $<HTMLInputElement>('#cd-email').value.trim();
    const name = $<HTMLInputElement>('#cd-nome').value.trim();
    const msg = $('#cd-msg');
    if (!isEmail(email)) {
      msg.innerHTML = '<div class="msg">Digite um e-mail válido.</div>';
      return;
    }
    if (!$<HTMLInputElement>('#cd-ok').checked) {
      msg.innerHTML =
        '<div class="msg">O aceite dos termos de uso e da política de privacidade é obrigatório para criar a conta.</div>';
      return;
    }
    S.user = { name: name || email.split('@')[0], email };
    S.dex = {};
    persist();
    renderConta();
    toast('conta criada');
  });
};
