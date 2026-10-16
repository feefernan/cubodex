import { ITEMS, LAUNCH_DATE } from '../domain/catalog';
import { isEmail } from '../domain/validation';
import { tickCountdowns } from './collectibles';
import { $, $$, onAction, onSubmit } from './dom';
import { registerView } from './router';
import { S } from './store';
import { fillProducts, itemTile } from './tiles';

const NEWS =
  `<a class="news news--hot" href="#serie" data-action="go" data-view="serie"><span class="mono">lançamento · série 01</span><h3>fiozinho chega em</h3><span class="cd num" data-t="${LAUNCH_DATE}">--</span><span class="mono">data de exemplo</span></a>` +
  '<a class="news" href="#tcg" data-action="go" data-view="tcg"><span class="mono tag">novidade · tcg</span><h3>charizard 4/102 · 1ª edição</h3><span class="mono soft">PSA 8 · última unidade</span></a>' +
  '<a class="news" href="#criar" data-action="go" data-view="criar"><span class="mono tag">novo em criar</span><h3>torre de dados</h3><span class="mono soft">PETG · 80 × 80 × 160 mm</span></a>' +
  '<a class="news" href="#avisos" data-action="scroll" data-target="avisos"><span class="mono tag">lista de avisos</span><h3>receba o próximo lançamento primeiro</h3><span class="mono soft">entrar na lista →</span></a>';

const renderHome = () => {
  $('#hl-tcg').innerHTML = ['i1', 'i2', 'i8']
    .flatMap((id) => ITEMS.filter((it) => it.id === id))
    .map(itemTile)
    .join('');
  fillProducts($('#hl-col'), ['m1', 'm6', 'm10']);
  fillProducts($('#hl-criar'), ['k1', 'k2', 'k3']);
  $('#news').innerHTML = NEWS;
  tickCountdowns();
};

const APOIO: Record<string, string> = {
  sobre:
    '<h2>sobre a cubodex</h2><p>A Cubodex junta duas coisas: cartas de pokémon originais e peças impressas em 3D. Colecionar e criar na mesma loja.</p><div class="todo">História do Fiozinho: texto a escrever.</div>',
  comprar:
    '<h2>como comprar</h2><p>Escolha os itens, calcule o frete pelo CEP no carrinho e pague pelo checkout do Mercado Pago. Para peças sob medida, peça um orçamento em Criar antes.</p><div class="todo">Texto de exemplo. Revisar quando o fluxo real existir.</div>',
  frete:
    '<h2>frete e prazos</h2><p>O frete é calculado por CEP no carrinho. Peças impressas sob encomenda têm prazo combinado no orçamento.</p><div class="todo">Prazos reais e transportadoras: a definir.</div>',
  contato:
    '<h2>contato</h2><p>Instagram e TikTok: <b style="color:var(--fg)">@cubodex</b>. Orçamentos e dúvidas pelo WhatsApp.</p><div class="todo">Número de WhatsApp: a preencher.</div>',
  privacidade:
    '<h2>política de privacidade</h2><p>Cadastro, e-mail e endereço são dados pessoais e entram na LGPD. A política e o texto de consentimento do cadastro serão escritos com apoio jurídico.</p><div class="todo">Texto provisório. Não usar em produção sem revisão.</div>',
  termos:
    '<h2>termos de uso</h2><p>Os termos precisam cobrir a guarda de itens no cofre, extravio e o prazo máximo de guarda.</p><div class="todo">Requisitos legais não verificados. Texto a ser escrito com apoio de um advogado.</div>',
  faq: '<h2>faq</h2><div class="faq"><details open><summary>O que é o cofre virtual?</summary><p>É onde ficam as cartas que você comprou na Cubodex e escolheu guardar. Você junta vários itens e pede um envio só.</p></details><details><summary>Como escolho entre enviar agora e guardar?</summary><p>No carrinho, cada carta tem as opções enviar agora ou guardar no cofre.</p></details><details><summary>Posso guardar cartas que já tenho?</summary><p>Na primeira versão não. O cofre guarda só itens comprados na Cubodex.</p></details><details><summary>Por quanto tempo posso guardar uma carta?</summary><p>O prazo máximo ainda não foi definido.</p></details><details><summary>A Cubodex é afiliada à The Pokémon Company?</summary><p>Não.</p></details><details><summary>Posso pedir uma peça sob medida?</summary><p>Sim, em Criar. O orçamento vem pelo WhatsApp.</p></details></div><div class="todo">FAQ provisória, a revisar com as decisões em aberto.</div>',
};

const renderApoio = () => {
  if (!APOIO[S.apoio]) S.apoio = 'sobre';
  for (const b of $$('#apoioTabs [data-tab]')) {
    const on = String(b.dataset.tab === S.apoio);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-selected', on);
  }
  $('#apoioBody').innerHTML = `<div class="prose">${APOIO[S.apoio]}</div>`;
};

const message = (el: HTMLElement, html: string) => {
  el.innerHTML = `<div class="msg">${html}</div>`;
};

export const initPages = () => {
  registerView('home', renderHome);
  registerView('criar', () => fillProducts($('#criarGrid'), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']));
  registerView('apoio', renderApoio);
  onAction('apoio-tab', (el) => {
    S.apoio = el.dataset.tab ?? 'sobre';
    renderApoio();
  });
  // shortcut: os formulários só confirmam na tela — lista de avisos em #19, WhatsApp em #18.
  onSubmit('formAvisos', () => {
    const msg = $('#av-msg');
    if (!isEmail($<HTMLInputElement>('#av-email').value.trim())) return message(msg, 'Digite um e-mail válido.');
    if (!$<HTMLInputElement>('#av-ok').checked) return message(msg, 'Marque o aceite para entrar na lista.');
    message(msg, '<b>Na lista.</b> Neste protótipo o e-mail não é enviado a lugar nenhum.');
  });
  onSubmit('formEncomenda', () => {
    const msg = $('#en-msg');
    if (!$<HTMLTextAreaElement>('#en-desc').value.trim())
      return message(msg, 'Descreva o que você precisa para pedir o orçamento.');
    message(
      msg,
      '<b>Pedido registrado.</b> No site real, a conversa abriria no WhatsApp com estes dados. Aqui nada é enviado.',
    );
  });
};
