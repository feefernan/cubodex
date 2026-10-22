import { ITEMS, listedOf } from '../domain/catalog';
import { quoteRequestText, whatsappUrl } from '../domain/contact';
import { escapeHtml as esc } from '../domain/format';
import { homeNews, type NewsCard } from '../domain/news';
import { isEmail } from '../domain/validation';
import { api } from '../infra/api';
import { APOIO } from './apoio';
import { alertMsg, progress } from './cart';
import { tickCountdowns } from './collectibles';
import { $, $$, check, onAction, onSubmit } from './dom';
import { go, registerView } from './router';
import { S } from './store';
import { fillProducts, itemTile } from './tiles';

const LAUNCH_NEWS =
  '<a class="news news--hot" href="#/serie" data-action="go" data-view="serie"><span class="mono">lançamento · série 01</span><h3>fiozinho chega</h3><span class="cd num">em breve</span><span class="mono">entre na lista para saber primeiro</span></a>';
const OPT_IN_NEWS =
  '<a class="news" href="#avisos" data-action="scroll" data-target="avisos"><span class="mono tag">lista de avisos</span><h3>receba o próximo lançamento primeiro</h3><span class="mono soft">entrar na lista →</span></a>';

const newsCard = (n: NewsCard) =>
  `<a class="news" href="#/${n.view}${n.id ? `/${n.id}` : ''}" data-action="go" data-view="${n.view}"${n.id ? ` data-id="${esc(n.id)}"` : ''}><span class="mono tag">${esc(n.tag)}</span><h3>${esc(n.title)}</h3><span class="mono soft">${esc(n.sub)}</span></a>`;

const renderHome = () => {
  $('#hl-tcg').innerHTML = ['i1', 'i2', 'i8', 'i5']
    .flatMap((id) => ITEMS.filter((it) => it.id === id && it.status !== 'esgotado'))
    .map(itemTile)
    .join('');
  fillProducts($('#hl-col'), listedOf('mini', 4));
  fillProducts($('#hl-criar'), listedOf('craft', 4));
  $('#news').innerHTML = LAUNCH_NEWS + homeNews().map(newsCard).join('') + OPT_IN_NEWS;
  tickCountdowns();
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
  registerView('criar', () => fillProducts($('#criarGrid'), listedOf('craft')));
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
