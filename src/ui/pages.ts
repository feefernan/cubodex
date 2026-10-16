import { ITEMS, LAUNCH_DATE } from '../domain/catalog';
import { quoteRequestText, whatsappUrl } from '../domain/contact';
import { escapeHtml as esc } from '../domain/format';
import { isEmail } from '../domain/validation';
import { api } from '../infra/api';
import { alertMsg, progress } from './cart';
import { tickCountdowns } from './collectibles';
import { $, $$, check, onAction, onSubmit } from './dom';
import { go, registerView } from './router';
import { S } from './store';
import { fillProducts, itemTile } from './tiles';

const NEWS =
  `<a class="news news--hot" href="#/serie" data-action="go" data-view="serie"><span class="mono">lançamento · série 01</span><h3>fiozinho chega em</h3><span class="cd num" data-t="${LAUNCH_DATE}">--</span><span class="mono">data de exemplo</span></a>` +
  '<a class="news" href="#/tcg" data-action="go" data-view="tcg"><span class="mono tag">novidade · tcg</span><h3>charizard 4/102 · 1ª edição</h3><span class="mono soft">PSA 8 · última unidade</span></a>' +
  '<a class="news" href="#/criar" data-action="go" data-view="criar"><span class="mono tag">novo em criar</span><h3>torre de dados</h3><span class="mono soft">PETG · 80 × 80 × 160 mm</span></a>' +
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
  }
  $('#apoioBody').innerHTML = `<div class="prose">${APOIO[S.apoio]}</div>`;
};

/** Saída para o WhatsApp (trocável nos testes). */
const nav = { open: (url: string) => window.open(url, '_blank', 'noopener') };

const msgHtml = (html: string) => `<div class="msg">${html}</div>`;
const message = (el: HTMLElement, html: string) => {
  el.innerHTML = msgHtml(html);
};

export const initPages = () => {
  registerView('home', renderHome);
  registerView('criar', () => fillProducts($('#criarGrid'), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']));
  registerView('apoio', renderApoio);
  onAction('apoio-tab', (el) => go('apoio', el.dataset.tab));
  onSubmit('formAvisos', async (form) => {
    const msg = $('#av-msg');
    const email = $<HTMLInputElement>('#av-email');
    const ok = $<HTMLInputElement>('#av-ok');
    if (!check(email, msg, isEmail(email.value.trim()), msgHtml('Digite um e-mail válido.'))) return;
    if (!check(ok, msg, ok.checked, msgHtml('Marque o aceite para entrar na lista.'))) return;
    const button = $<HTMLButtonElement>('button[type="submit"]', form);
    button.disabled = true;
    msg.innerHTML = progress('inscrevendo…');
    try {
      await api.subscribe(email.value.trim());
      message(msg, '<b>Na lista.</b> Você recebe um e-mail quando sair a próxima série.');
      (form as HTMLFormElement).reset();
    } catch (e) {
      msg.innerHTML = alertMsg((e as Error).message);
    } finally {
      button.disabled = false;
    }
  });
  onSubmit('formEncomenda', () => {
    const msg = $('#en-msg');
    const desc = $<HTMLTextAreaElement>('#en-desc');
    if (!check(desc, msg, !!desc.value.trim(), msgHtml('Descreva o que você precisa para pedir o orçamento.'))) return;
    const text = quoteRequestText({
      name: $<HTMLInputElement>('#en-nome').value,
      description: desc.value,
      size: $<HTMLInputElement>('#en-med').value,
      material: $<HTMLSelectElement>('#en-mat').value,
    });
    const url = whatsappUrl(text);
    if (!url) {
      message(
        msg,
        'O WhatsApp da Cubodex ainda não está configurado. Fale com a gente pelo Instagram <b>@cubodex</b>.',
      );
      return;
    }
    message(
      msg,
      `<b>Quase lá.</b> Abrimos o WhatsApp com o seu pedido. Se não abriu, <a href="${esc(url)}" target="_blank" rel="noopener">toque aqui</a>. Fotos e arquivos você manda direto na conversa.`,
    );
    nav.open(url);
  });
};
