import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel) as T;
const click = (sel: string) => $(sel).click();
const visible = () => [...document.querySelectorAll<HTMLElement>('.view')].filter((v) => !v.hidden).map((v) => v.id);
const type = (sel: string, value: string) => {
  const el = $<HTMLInputElement>(sel);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const check = (sel: string, on: boolean) => {
  const el = $<HTMLInputElement>(sel);
  el.checked = on;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (sel: string) => $<HTMLFormElement>(sel).requestSubmit();
const goTo = (view: string) => click(`[data-action="go"][data-view="${view}"]`);
const saved = () => JSON.parse(localStorage.getItem('cubodex-proto-v1') ?? '{}');

beforeAll(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = body;
  await import('../../src/main');
});

beforeEach(() => {
  click('.site-head .brand');
});

describe('navegação', () => {
  it('começa na home com destaques e contagem regressiva', () => {
    expect(visible()).toEqual(['v-home']);
    expect(document.querySelectorAll('#hl-tcg .tile')).toHaveLength(3);
    expect(document.querySelectorAll('#hl-col .tile')).toHaveLength(3);
    expect($('#news .cd').textContent).toMatch(/\d+d|já saiu/);
    expect(document.body.className).toBe('a-home');
  });

  it('troca de tela, acende menu e subnavegação, e grava o hash', () => {
    goTo('colecionar');
    expect(visible()).toEqual(['v-colecionar']);
    expect($('[data-nav="col"]').getAttribute('aria-current')).toBe('page');
    expect($('#subnav').hidden).toBe(false);
    click('#v-colecionar [data-view="tcg"]');
    expect(visible()).toEqual(['v-tcg']);
    expect(document.body.className).toBe('a-tcg');
    expect($('#v-tcg .tcgnav [aria-current="page"]').textContent).toBe('cartas à venda');
    expect(location.hash).toBe('#/tcg');
    expect(document.activeElement).toBe($('#v-tcg h1'));
    expect(document.title).toBe('cartas à venda · Cubodex');
    goTo('criar');
    expect($('#subnav').hidden).toBe(true);
    expect(document.querySelectorAll('#criarGrid .tile')).toHaveLength(6);
  });

  it('links com id vão para a URL e o voltar do navegador volta de tela (#8)', async () => {
    goTo('sets');
    click('.setcard[data-id="jungle"]');
    expect(location.hash).toBe('#/set/jungle');
    expect($('#setBody h1').textContent).toBe('Jungle');
    click('#setGrid a.media[data-view="carta"]');
    expect(location.hash).toMatch(/^#\/carta\/jungle-/);
    history.back();
    await vi.waitFor(() => expect(visible()).toEqual(['v-set']));
    expect($('#setBody h1').textContent).toBe('Jungle');
  });

  it('URL editada à mão abre a tela certa; tela desconhecida cai na home (#8)', async () => {
    location.hash = '#/carta/sv151-151';
    await vi.waitFor(() => expect(visible()).toEqual(['v-carta']));
    expect($('#cartaBody h1').textContent).toBe('mew ex');
    location.hash = '#/nao-existe';
    await vi.waitFor(() => expect(visible()).toEqual(['v-home']));
  });

  it('rola até a lista de avisos pelo card de novidades', () => {
    click('[data-action="scroll"]');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe('tcg', () => {
  it('filtra, ordena, mostra vazio e limpa', () => {
    goTo('tcg');
    expect($('#tcgCount').textContent).toBe('12 itens');
    type('#f-lang', 'PT');
    expect($('#tcgCount').textContent).toBe('3 itens');
    check('#f-grad', true);
    expect($('#tcgCount').textContent).toBe('0 itens');
    expect($('#tcgGrid .empty')).not.toBeNull();
    click('#tcgGrid [data-action="filters-clear"]');
    expect($('#tcgCount').textContent).toBe('12 itens');
    expect($<HTMLInputElement>('#f-grad').checked).toBe(false);
    type('#f-q', 'pikachu');
    expect($('#tcgCount').textContent).toBe('2 itens');
    click('[data-action="filters-clear"]');
  });

  it('enciclopédia: busca de set, set, só à venda e página da carta', () => {
    goTo('sets');
    expect(document.querySelectorAll('.setcard')).toHaveLength(4);
    type('#s-q', 'xyz');
    expect($('#setsBody .empty')).not.toBeNull();
    type('#s-q', '');
    type('#s-ano', '2023');
    expect(document.querySelectorAll('.setcard')).toHaveLength(1);
    click('.setcard');
    expect($('#setBody h1').textContent).toBe('151');
    click('[data-action="set-rar"][data-v="comum"]');
    expect(document.querySelectorAll('#setGrid .tile')).toHaveLength(1);
    click('[data-action="set-rar"][data-v=""]');
    click('[data-action="set-only"]');
    expect(document.querySelectorAll('#setGrid .tile.hit')).toHaveLength(
      document.querySelectorAll('#setGrid .tile').length,
    );
    click('#setGrid a.btn[data-view="carta"]');
    expect(visible()).toEqual(['v-carta']);
    expect(document.querySelectorAll('#cartaBody .sale-row').length).toBeGreaterThan(0);
    type('#s-ano', '');
  });

  it('acessórios e imagens desligadas', () => {
    goTo('acessorios');
    expect(document.querySelectorAll('#accGrid .tile')).toHaveLength(4);
    goTo('tcg');
    click('#themerBtn');
    check('[data-input="toggle-images"]', false);
    expect($('#tcgGrid .ph-label').textContent).toBe('imagem desativada');
    check('[data-input="toggle-images"]', true);
  });
});

describe('carrinho', () => {
  it('adiciona, limita ao estoque, calcula frete e paga (simulado)', () => {
    goTo('tcg');
    click('#tcgGrid [data-action="add"][data-id="i1"]');
    expect($('#cartCount').textContent).toBe('1');
    click('#tcgGrid [data-action="add"][data-id="i1"]');
    expect($('#toast').textContent).toBe('só 1 un. em estoque');
    goTo('carrinho');
    expect(document.querySelectorAll('.line')).toHaveLength(1);
    expect($<HTMLButtonElement>('[data-action="pay"]').disabled).toBe(true);
    type('#cep', '1');
    submit('#formFrete');
    expect($('#cep-msg').textContent).toBe('CEP com 8 dígitos, por favor.');
    expect($('#cep').getAttribute('aria-invalid')).toBe('true');
    expect($('#cep').getAttribute('aria-describedby')).toBe('cep-msg');
    type('#cep', '01310100');
    expect($<HTMLInputElement>('#cep').value).toBe('01310-100');
    submit('#formFrete');
    expect(document.querySelectorAll('.ship-opt')).toHaveLength(2);
    click('[data-action="ship"][data-i="1"]');
    expect($('.sum-row.total').textContent).toContain('917,50');
    click('[data-action="pay"]');
    expect($('#cartBody .msg').textContent).toContain('Fase 2');
    expect(saved().cart).toHaveLength(1);
  });

  it('guardar no cofre tira o frete; quantidade e remover', () => {
    goTo('carrinho');
    click('[data-action="dest"][data-v="vault"]');
    expect($('#cartBody').textContent).toContain('Tudo vai para o cofre');
    click('[data-action="qty"][data-d="1"]');
    expect($('#toast').textContent).toBe('só 1 un. em estoque');
    click('[data-action="remove"]');
    expect($('#cartBody .empty')).not.toBeNull();
    expect($('#cartCount').dataset.n).toBe('0');
  });

  it('carrinho salvo com item esgotado é limpo ao abrir, com aviso (#7)', async () => {
    const { S } = await import('../../src/ui/store');
    S.cart.push({ id: 'i7', qty: 1 }, { id: 'a1', qty: 1 });
    goTo('carrinho');
    expect($('#toast').textContent).toBe('um item esgotou e saiu do carrinho');
    expect(document.querySelectorAll('.line')).toHaveLength(1);
    expect(saved().cart).toEqual([{ id: 'a1', qty: 1 }]);
    click('[data-action="remove"]');
  });

  it('monta o pacote de 3 miniaturas', () => {
    goTo('serie');
    expect($('[data-action="pack-buy"]').textContent).toBe('faltam 3');
    for (const id of ['m1', 'm2', 'm3', 'm4']) click(`[data-action="pack-add"][data-id="${id}"]`);
    expect($('#toast').textContent).toBe('pacote cheio');
    expect(document.querySelectorAll('.slot.filled')).toHaveLength(3);
    click('[data-action="pack-buy"]');
    expect($('#cartCount').textContent).toBe('1');
    click('[data-action="pack-add"][data-id="m1"]');
    click('[data-action="pack-clear"]');
    expect(document.querySelectorAll('.slot.filled')).toHaveLength(0);
    goTo('carrinho');
    expect($('#cartBody').textContent).toContain('pacote fiozinho');
    click('[data-action="qty"][data-d="1"]');
    expect($('#cartCount').textContent).toBe('2');
    click('[data-action="remove"]');
  });
});

describe('colecionáveis, dex e cofre', () => {
  it('visitante novo começa deslogado: dex e cofre pedem login (#5)', () => {
    expect(saved().user ?? null).toBeNull();
    goTo('dex');
    expect($('#dexBody [data-action="login-demo"]')).not.toBeNull();
    goTo('cofre');
    expect($('#cofreBody [data-action="login-demo"]')).not.toBeNull();
    goTo('conta');
    expect($('#formLogin')).not.toBeNull();
  });

  it('séries, contagem da dex e marcações', () => {
    goTo('colecionaveis');
    expect(document.querySelectorAll('#seriesRow .series')).toHaveLength(2);
    goTo('dex');
    click('#dexBody [data-action="login-demo"]');
    expect($('#dexBody .dex-count').textContent).toContain('5');
    click('[data-action="dex"][data-id="m3"][data-st="have"]');
    expect($('#dexBody .dex-count').textContent).toContain('6');
    expect(saved().dex.m3).toBe('have');
    click('[data-action="dex-filter"][data-v="quero"]');
    expect(document.querySelectorAll('.dex-tile')).toHaveLength(2);
    click('[data-action="dex-series"][data-v="s2"]');
    expect(document.querySelectorAll('.dex-locked')).toHaveLength(12);
    click('[data-action="dex-series"][data-v="s1"]');
    click('[data-action="dex-filter"][data-v="todos"]');
  });

  it('cofre: seleciona, cota e pede envio', () => {
    goTo('cofre');
    expect($<HTMLButtonElement>('[data-action="vault-pay"]').disabled).toBe(true);
    check('[data-input="vault-select"][data-id="v1"]', true);
    type('#vcep', '20040020');
    submit('#formVFrete');
    click('[data-action="vault-ship"][data-i="0"]');
    click('[data-action="vault-pay"]');
    expect($('#toast').textContent).toBe('pedido de envio criado (simulado)');
    expect($('#cofreBody .timeline li').textContent).toContain('pedido de envio · blastoise');
    type('#vcep', '123');
    submit('#formVFrete');
    expect($('#vcep-msg').textContent).toBe('CEP com 8 dígitos, por favor.');
  });
});

describe('conta e formulários', () => {
  it('a demo mostra pedidos de exemplo; ao sair, os dados de exemplo somem', () => {
    goTo('conta');
    expect($('#contaBody').textContent).toContain('#1042');
    click('[data-action="logout"]');
    expect($('#formLogin')).not.toBeNull();
    expect(saved()).toMatchObject({ user: null, dex: {}, vault: [], hist: [] });
  });

  it('cria conta e entra sem dados de exemplo', () => {
    goTo('conta');
    type('#cd-email', 'x');
    submit('#formCadastro');
    expect($('#cd-msg').textContent).toContain('e-mail válido');
    type('#cd-email', 'ana@exemplo.com');
    submit('#formCadastro');
    expect($('#cd-msg').textContent).toContain('obrigatório');
    $<HTMLInputElement>('#cd-ok').checked = true;
    submit('#formCadastro');
    expect($('#contaBody').textContent).toContain('Olá, ana');
    expect($('#contaBody').textContent).toContain('Nenhum pedido ainda');
    expect($('#contaBody').textContent).not.toContain('#1042');
    goTo('cofre');
    expect($('#cofreBody').textContent).toContain('Nada guardado ainda');
    goTo('conta');
    click('[data-action="logout"]');
    type('#lg-email', 'bia@exemplo.com');
    submit('#formLogin');
    expect($('#contaBody').textContent).toContain('Olá, bia');
    click('[data-action="logout"]');
    click('[data-action="login-demo"]');
    expect($('#contaBody').textContent).toContain('colecionador demo');
  });

  it('lista de avisos e encomenda validam antes de confirmar', () => {
    type('#av-email', 'ruim');
    submit('#formAvisos');
    expect($('#av-msg').textContent).toContain('e-mail válido');
    expect($('#av-email').getAttribute('aria-invalid')).toBe('true');
    type('#av-email', 'a@b.co');
    submit('#formAvisos');
    expect($('#av-msg').textContent).toContain('aceite');
    expect($('#av-email').hasAttribute('aria-invalid')).toBe(false);
    $<HTMLInputElement>('#av-ok').checked = true;
    submit('#formAvisos');
    expect($('#av-msg').textContent).toContain('Na lista');
    goTo('criar');
    submit('#formEncomenda');
    expect($('#en-msg').textContent).toContain('Descreva');
    $<HTMLTextAreaElement>('#en-desc').value = 'display para 12 cards';
    submit('#formEncomenda');
    expect($('#en-msg').textContent).toContain('Pedido registrado');
  });

  it('ajuda abre na aba do rodapé e troca de aba', () => {
    click('footer [data-tab="faq"]');
    expect(visible()).toEqual(['v-apoio']);
    expect($('#apoioBody h2').textContent).toBe('faq');
    click('[data-action="apoio-tab"][data-tab="termos"]');
    expect($('#apoioBody h2').textContent).toBe('termos de uso');
    expect($('#apoioTabs [data-tab="termos"]').getAttribute('aria-pressed')).toBe('true');
    expect(location.hash).toBe('#/apoio/termos');
  });

  it('seletor de tema abre, troca, salva e fecha ao clicar fora', () => {
    click('#themerBtn');
    expect($('#themerPanel').hidden).toBe(false);
    click('[data-action="set-theme"][data-id="1b"]');
    expect(document.documentElement.dataset.tema).toBe('1b');
    expect(localStorage.getItem('cubodex-proto-tema')).toBe('1b');
    expect($('#themerPanel').hidden).toBe(true);
    click('#themerBtn');
    click('main');
    expect($('#themerPanel').hidden).toBe(true);
  });
});
