import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tcgApi } from '../fixtures/tcg';

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

/** API da loja e ViaCEP falsos: guardam o que o site mandou e respondem como os reais. */
const api = {
  sent: [] as { url: string; body: Record<string, unknown> | null }[],
  fail: null as null | { status: number; error: string },
  checkoutUrl: 'https://mp.test/pagar' as string | null,
  status: 'Aguardando pagamento',
  products: [] as unknown[],
  account: null as null | {
    user: { name: string; email: string };
    dex: Record<string, 'have' | 'want'>;
    vault: {
      id: string;
      productId: string;
      name: string;
      meta: string;
      date: string;
      qty: number;
      st: 'cofre' | 'envio' | 'enviado';
    }[];
    hist: { d: string; t: string }[];
    orders: {
      serial: string;
      kind: 'compra' | 'envio';
      status: string;
      total: number;
      summary: string;
      created_at: string;
    }[];
  },
};
const ACCOUNT = {
  user: { name: 'ana', email: 'ana@exemplo.com' },
  dex: { m2: 'have' as const },
  vault: [
    {
      id: 'u1',
      productId: 'i2',
      name: 'Blastoise 2/102',
      meta: 'EN · normal',
      date: '16/10',
      qty: 1,
      st: 'cofre' as const,
    },
  ],
  hist: [{ d: '16/10', t: 'guardado no cofre · Blastoise 2/102' }],
  orders: [
    {
      serial: 'CBX-20261016-AAAAAA',
      kind: 'compra' as const,
      status: 'Pago',
      total: 420,
      summary: '1× blastoise',
      created_at: '',
    },
  ],
};
const SHIPPING = [
  { id: 1, name: 'PAC', company: 'Correios', price: 22.5, days: 7 },
  { id: 2, name: 'SEDEX', company: 'Correios', price: 38.9, days: 3 },
];
const apiFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  api.sent.push({ url, body });
  if (url.startsWith('https://viacep.com.br/'))
    return Response.json({ logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' });
  if (api.fail && url !== '/api/catalog') return Response.json({ error: api.fail.error }, { status: api.fail.status });
  const tcg = tcgApi(url);
  if (tcg) return Response.json(tcg.body, { status: tcg.status });
  if (url === '/api/catalog') return Response.json({ products: api.products });
  if (url === '/api/shipping/quote') return Response.json({ options: SHIPPING });
  if (url === '/api/orders')
    return Response.json({ serial: 'CBX-20261016-ABCDEF', total: 1, checkoutUrl: api.checkoutUrl }, { status: 201 });
  if (url.endsWith('/status')) return Response.json({ status: api.status });
  if (url === '/api/avisos') return Response.json({ ok: true }, { status: 201 });
  if (url === '/api/auth/logout') return Response.json({ ok: true });
  if (url === '/api/me' && init?.method === 'DELETE')
    return api.account?.vault.some((v) => v.st === 'cofre')
      ? Response.json(
          { error: 'Você ainda tem itens no cofre. Peça o envio antes de apagar a conta.' },
          { status: 409 },
        )
      : Response.json({ ok: true });
  if (url === '/api/me')
    return api.account ? Response.json(api.account) : Response.json({ error: 'Entre' }, { status: 401 });
  if (url === '/api/dex') return Response.json({ dex: body?.dex });
  if (url === '/api/vault/ship')
    return Response.json(
      { serial: 'CBX-20261016-VAULT2', total: 22.5, checkoutUrl: 'https://mp.test/envio' },
      { status: 201 },
    );
  return Response.json({ error: 'não encontrado' }, { status: 404 });
});
const lastSent = (url: string) => [...api.sent].reverse().find((c) => c.url === url)?.body;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  vi.stubGlobal('fetch', apiFetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = body;
  await import('../../src/main');
});

beforeEach(() => {
  click('.site-head .brand');
});

/** Fecha o checkout aberto e limpa o comprador: o estado da tela é um só entre os testes. */
const resetCheckout = async () => {
  const { S } = await import('../../src/ui/store');
  Object.assign(S, { checkout: false, paying: false, payError: '', pendingSerial: '' });
  Object.assign(S.buyer, {
    name: '',
    email: '',
    cpf: '',
    phone: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    uf: '',
  });
};

describe('navegação', () => {
  it('começa na home com destaques e contagem regressiva', () => {
    expect(visible()).toEqual(['v-home']);
    expect(document.querySelectorAll('#hl-tcg .tile')).toHaveLength(4);
    expect(document.querySelectorAll('#hl-col .tile')).toHaveLength(4);
    // Sem data de lançamento definida, nada de contagem inventada.
    expect($('#news .cd').textContent).toBe('em breve');
    expect(document.body.textContent).not.toMatch(/protótipo|data de exemplo|versão real|no site real/i);
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
    // Volta ao topo sem animar a rolagem (#13).
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    expect(document.activeElement).toBe($('#v-tcg h1'));
    expect(document.title).toBe('cartas à venda · Cubodex');
    goTo('criar');
    expect($('#subnav').hidden).toBe(true);
    expect(document.querySelectorAll('#criarGrid .tile')).toHaveLength(6);
  });

  it('links com id vão para a URL e o voltar do navegador volta de tela (#8)', async () => {
    goTo('sets');
    await vi.waitFor(() => expect(document.querySelectorAll('.setcard').length).toBeGreaterThan(0));
    click('.setcard[data-id="base2"]');
    expect(location.hash).toBe('#/set/base2');
    await vi.waitFor(() => expect($('#setBody h1').textContent).toBe('Jungle · Selva'));
    click('#setGrid a.media[data-view="carta"]');
    expect(location.hash).toMatch(/^#\/carta\/base2-/);
    history.back();
    await vi.waitFor(() => expect(visible()).toEqual(['v-set']));
    await vi.waitFor(() => expect($('#setBody h1').textContent).toBe('Jungle · Selva'));
  });

  it('URL editada à mão abre a tela certa; tela desconhecida cai na home (#8)', async () => {
    location.hash = '#/carta/sv03.5-151';
    await vi.waitFor(() => expect(visible()).toEqual(['v-carta']));
    await vi.waitFor(() => expect($('#cartaBody h1').textContent).toBe('Mew ex'));
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

  it('enciclopédia: sets por série, busca de set e de carta, só à venda e página da carta', async () => {
    goTo('sets');
    await vi.waitFor(() => expect(document.querySelectorAll('.setcard')).toHaveLength(4));
    // A série mais nova abre; as outras ficam fechadas (as imagens delas nem são baixadas).
    expect([...document.querySelectorAll<HTMLDetailsElement>('.sets-group')].map((d) => d.open)).toEqual([
      true,
      false,
      false,
    ]);
    expect($('.setcard[data-id="sv03.5"]').textContent).toContain('151');
    expect($('.setcard[data-id="sv03.5"]').textContent).toContain('à venda na cubodex');
    type('#s-q', 'xyz');
    expect($('#setsBody .empty')).not.toBeNull();
    type('#s-q', 'selva'); // o nome em português também acha
    expect(document.querySelectorAll('.setcard')).toHaveLength(1);
    type('#s-q', '');
    type('#s-ano', '2023');
    expect(document.querySelectorAll('.setcard')).toHaveLength(1);
    type('#s-card', 'char');
    await vi.waitFor(() => expect(document.querySelectorAll('#cardResults li')).toHaveLength(2));
    expect($('#cardResults').textContent).toContain('Charizard · Charizard PT');
    type('#s-card', 'zzzz');
    await vi.waitFor(() => expect($('#cardResults').textContent).toContain('Nenhuma carta'));
    type('#s-card', '');
    expect($('#cardResults').innerHTML).toBe('');
    click('.setcard');
    await vi.waitFor(() => expect($('#setBody h1').textContent).toBe('151'));
    expect(document.querySelectorAll('#setGrid .tile')).toHaveLength(3);
    click('[data-action="set-rar"][data-v="Common"]');
    expect(document.querySelectorAll('#setGrid .tile')).toHaveLength(1);
    click('[data-action="set-rar"][data-v=""]');
    type('#set-q', 'mew');
    expect(document.querySelectorAll('#setGrid .tile')).toHaveLength(1);
    type('#set-q', '');
    click('[data-action="set-only"]');
    expect(document.querySelectorAll('#setGrid .tile.hit').length).toBe(
      document.querySelectorAll('#setGrid .tile').length,
    );
    expect($('#setGrid .tile.hit').textContent).toContain('à venda · a partir de');
    click('#setGrid a.media[data-view="carta"]');
    await vi.waitFor(() => expect(visible()).toEqual(['v-carta']));
    await vi.waitFor(() => expect(document.querySelectorAll('#cartaBody .sale-row').length).toBeGreaterThan(0));
    click('[data-action="set-only"]');
    type('#s-ano', '');
  });

  it('enciclopédia: set grande mostra 60 de cada vez; carta sem imagem, raridade e tipos', async () => {
    location.hash = '#/set/pop1';
    await vi.waitFor(() => expect($('#setBody h1').textContent).toBe('POP Series 1'));
    expect($('#setBody').textContent).not.toContain('secretas');
    expect(document.querySelectorAll('#setGrid .tile')).toHaveLength(60);
    expect($('#setCount').textContent).toBe('mostrando 60 de 70 cartas do set');
    expect($<HTMLButtonElement>('#setMore').hidden).toBe(false);
    click('[data-action="set-more"]');
    expect(document.querySelectorAll('#setGrid .tile')).toHaveLength(70);
    expect($<HTMLButtonElement>('#setMore').hidden).toBe(true);
    expect(document.querySelector('#setGrid img')).toBeNull(); // nenhuma tem imagem
    type('#set-q', 'treinador 7');
    expect(document.querySelectorAll('#setGrid .tile')).toHaveLength(2); // "Treinador 7" e "Treinador 70"
    type('#set-q', 'nada');
    expect($('#setGrid .empty')).not.toBeNull();
    type('#set-q', '');
    location.hash = '#/carta/pop1-5';
    await vi.waitFor(() => expect($('#cartaBody h1').textContent).toBe('Treinador 5'));
    expect($('#cartaBody img')).toBeNull();
    expect($('#cartaBody .spec').textContent).toContain('raridade—');
    expect($('#cartaBody').textContent).toContain('A Cubodex não tem item à venda');
  });

  it('enciclopédia: erro de carga mostra o aviso e tentar de novo recarrega; carta e set que não existem', async () => {
    api.fail = { status: 503, error: 'A enciclopédia ainda não está disponível. Tente mais tarde.' };
    location.hash = '#/carta/base1-999';
    await vi.waitFor(() => expect($('#cartaBody [role="alert"]').textContent).toContain('ainda não está disponível'));
    api.fail = null;
    click('#cartaBody [data-action="tcg-retry"]');
    await vi.waitFor(() => expect($('#cartaBody [role="alert"]').textContent).toContain('Carta não encontrada'));
    location.hash = '#/set/nao-existe';
    await vi.waitFor(() => expect($('#setBody [role="alert"]').textContent).toContain('Set não encontrado'));
    click('#setBody [data-action="tcg-retry"]');
    await vi.waitFor(() => expect($('#setBody [role="alert"]')).not.toBeNull());
  });

  it('acessórios', () => {
    goTo('acessorios');
    expect(document.querySelectorAll('#accGrid .tile')).toHaveLength(4);
  });
});

describe('carrinho', () => {
  it('adiciona, limita ao estoque, cota o frete na API e vai para o pagamento', async () => {
    const { nav } = await import('../../src/ui/cart');
    const to = vi.spyOn(nav, 'to').mockImplementation(() => {});
    goTo('tcg');
    click('#tcgGrid [data-action="add"][data-id="i1"]');
    expect($('#cartCount').textContent).toBe('1');
    // Pulso no contador só quando aumenta (#13).
    expect($('#cartCount').classList.contains('bump')).toBe(true);
    click('#tcgGrid [data-action="add"][data-id="i1"]');
    expect($('#toast').textContent).toBe('só 1 un. em estoque');
    goTo('carrinho');
    expect(document.querySelectorAll('.line')).toHaveLength(1);
    expect($<HTMLButtonElement>('[data-action="checkout-open"]').disabled).toBe(true);
    type('#cep', '1');
    submit('#formFrete');
    expect($('#cep-msg').textContent).toBe('CEP com 8 dígitos, por favor.');
    expect($('#cep').getAttribute('aria-invalid')).toBe('true');
    expect($('#cep').getAttribute('aria-describedby')).toBe('cep-msg');
    type('#cep', '01310100');
    expect($<HTMLInputElement>('#cep').value).toBe('01310-100');
    submit('#formFrete');
    expect($('#cartBody').textContent).toContain('calculando frete');
    await vi.waitFor(() => expect(document.querySelectorAll('.ship-opt')).toHaveLength(2));
    expect(lastSent('/api/shipping/quote')).toEqual({ cep: '01310100', items: [{ id: 'i1', qty: 1, dest: 'send' }] });
    expect($('.ship-opt').textContent).toContain('Correios PAC');
    click('[data-action="ship"][data-i="1"]');
    expect($('.sum-row.total').textContent).toContain('928,90');

    click('[data-action="checkout-open"]');
    await vi.waitFor(() => expect($<HTMLInputElement>('#ck-street').value).toBe('Avenida Paulista'));
    submit('#formCheckout');
    expect($('#ck-msg').textContent).toContain('Digite seu nome');
    expect($('#ck-name').getAttribute('aria-invalid')).toBe('true');
    type('#ck-name', 'Ana Lima');
    type('#ck-email', 'ana@exemplo.com');
    type('#ck-cpf', '52998224725');
    type('#ck-phone', '11999998888');
    submit('#formCheckout');
    expect($('#ck-msg').textContent).toContain('número');
    type('#ck-number', '1000');
    submit('#formCheckout');
    expect($('#formCheckout button[type="submit"]').textContent).toBe('registrando pedido…');
    await vi.waitFor(() => expect(to).toHaveBeenCalledWith('https://mp.test/pagar'));
    expect(lastSent('/api/orders')).toEqual({
      items: [{ id: 'i1', qty: 1, dest: 'send' }],
      customer: { name: 'Ana Lima', email: 'ana@exemplo.com', cpf: '529.982.247-25', phone: '(11) 99999-8888' },
      address: {
        cep: '01310100',
        street: 'Avenida Paulista',
        number: '1000',
        complement: '',
        district: 'Bela Vista',
        city: 'São Paulo',
        uf: 'SP',
      },
      shipping: { serviceId: 2 },
    });
    expect(saved().cart).toHaveLength(1);
    // O pedido que saiu para o pagamento fica guardado: é só ele que esvazia o carrinho na volta.
    expect(saved().pendingSerial).toBe('CBX-20261016-ABCDEF');
  });

  it('CPF e telefone inválidos são recusados no checkout; "S/N" vale como número', async () => {
    goTo('carrinho');
    $<HTMLInputElement>('#cep').value = '01310100';
    submit('#formFrete');
    await vi.waitFor(() => expect(document.querySelectorAll('.ship-opt')).toHaveLength(2));
    click('[data-action="ship"][data-i="1"]');
    click('[data-action="checkout-open"]');
    await vi.waitFor(() => expect($<HTMLInputElement>('#ck-street').value).toBe('Avenida Paulista'));
    type('#ck-name', 'Ana Lima');
    type('#ck-email', 'ana@exemplo.com');
    type('#ck-cpf', '11111111111');
    submit('#formCheckout');
    expect($('#ck-msg').textContent).toContain('CPF válido');
    type('#ck-cpf', '52998224725');
    type('#ck-phone', '123');
    submit('#formCheckout');
    expect($('#ck-msg').textContent).toContain('telefone com DDD');
    type('#ck-phone', '11999998888');
    type('#ck-number', 'S/N');
    submit('#formCheckout');
    await vi.waitFor(() => expect(lastSent('/api/orders')).toMatchObject({ address: { number: 'S/N' } }));
    await resetCheckout();
  });

  it('o ViaCEP preenche os campos que ainda estão vazios, sem pisar no que já foi digitado nem desenhar o formulário de novo', async () => {
    goTo('carrinho');
    $<HTMLInputElement>('#cep').value = '01310100';
    submit('#formFrete');
    await vi.waitFor(() => expect(document.querySelectorAll('.ship-opt')).toHaveLength(2));
    click('[data-action="ship"][data-i="1"]');
    const { S } = await import('../../src/ui/store');
    S.buyer.district = 'Meu bairro';
    click('[data-action="checkout-open"]');
    const form = $('#formCheckout');
    await vi.waitFor(() => expect($<HTMLInputElement>('#ck-street').value).toBe('Avenida Paulista'));
    expect($('#formCheckout')).toBe(form);
    expect($<HTMLInputElement>('#ck-district').value).toBe('Meu bairro');
    await resetCheckout();
  });

  it('frete indisponível aparece como alerta e não deixa finalizar', async () => {
    goTo('carrinho');
    api.fail = { status: 503, error: 'Frete ainda não está ligado. Tente mais tarde.' };
    submit('#formFrete');
    await vi.waitFor(() => expect($('#cartBody [role="alert"]').textContent).toContain('Frete ainda não está ligado'));
    expect($<HTMLButtonElement>('[data-action="checkout-open"]').disabled).toBe(true);
    api.fail = null;
    submit('#formFrete');
    await vi.waitFor(() => expect(document.querySelectorAll('.ship-opt')).toHaveLength(2));
    click('[data-action="ship"][data-i="1"]');
  });

  it('erro da API no pedido aparece no formulário e o carrinho fica', async () => {
    goTo('carrinho');
    click('[data-action="checkout-open"]');
    await vi.waitFor(() => expect($<HTMLInputElement>('#ck-street').value).toBe('Avenida Paulista'));
    type('#ck-name', 'Ana Lima');
    type('#ck-email', 'ana@exemplo.com');
    type('#ck-cpf', '52998224725');
    type('#ck-phone', '11999998888');
    type('#ck-number', '1000');
    api.fail = { status: 409, error: 'Essa opção de frete mudou. Calcule o frete de novo.' };
    submit('#formCheckout');
    await vi.waitFor(() => expect($('#ck-msg').textContent).toContain('opção de frete mudou'));
    api.fail = null;
    expect(saved().cart).toHaveLength(1);
  });

  it('volta do pagamento: mostra o status e, pago, esvazia o carrinho do pedido que saiu para o pagamento', async () => {
    const { S } = await import('../../src/ui/store');
    location.hash = '#/pedido/CBX-20261016-ABCDEF';
    await vi.waitFor(() => expect($('#pedidoBody').textContent).toContain('Aguardando a confirmação'));
    // Pedido que não é o da compra em andamento (link antigo): mostra "Pago", mas o carrinho de agora fica.
    api.status = 'Pago';
    S.pendingSerial = 'CBX-20261016-ZZZZZZ';
    click('[data-action="order-refresh"]');
    await vi.waitFor(() => expect($('#pedidoBody').textContent).toContain('Pagamento confirmado'));
    expect($('#cartCount').textContent).toBe('1');
    // O pedido da própria compra: confirma e esvazia.
    S.pendingSerial = 'CBX-20261016-ABCDEF';
    click('[data-action="order-refresh"]');
    await vi.waitFor(() => expect($('#cartCount').textContent).toBe('0'));
    expect(saved().pendingSerial).toBe('');

    api.fail = { status: 502, error: 'Não foi possível consultar o pedido agora' };
    click('[data-action="order-refresh"]');
    await vi.waitFor(() => expect($('#pedidoBody [role="alert"]').textContent).toContain('consultar o pedido'));
    api.fail = null;
    // Saiu da página antes da resposta: a resposta atrasada não desenha por cima da tela nova.
    click('[data-action="order-refresh"]');
    goTo('criar');
    await settle();
    expect($('#pedidoBody').textContent).toContain('consultando');
    location.hash = '#/pedido/xyz';
    await vi.waitFor(() => expect($('#pedidoBody').textContent).toContain('não encontrado'));
    api.status = 'Aguardando pagamento';
  });

  it('Pix ou boleto ainda pendente: consulta de novo a cada 5 s por até 2 min e para', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const polls = () => api.sent.filter((c) => c.url.endsWith('/status')).length;
      const before = polls();
      location.hash = '#/pedido/CBX-20261016-ABCDEF';
      await vi.advanceTimersByTimeAsync(0);
      expect(polls() - before).toBe(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(polls() - before).toBe(2);
      // Confirmou: a próxima consulta mostra "Pago" e o relógio não arma outra.
      api.status = 'Pago';
      await vi.advanceTimersByTimeAsync(5000);
      expect($('#pedidoBody').textContent).toContain('Pagamento confirmado');
      const done = polls();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(polls()).toBe(done);
      // Sem confirmar, para sozinho depois de 24 consultas (2 min).
      api.status = 'Aguardando pagamento';
      const start = polls();
      click('[data-action="order-refresh"]');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(polls() - start).toBe(25);
    } finally {
      vi.useRealTimers();
      api.status = 'Aguardando pagamento';
    }
  });

  it('pedido cancelado no pagamento: o carrinho continua e a tela leva de volta a ele', async () => {
    const { S } = await import('../../src/ui/store');
    api.status = 'Cancelado';
    S.pendingSerial = 'CBX-20261016-ABCDEF';
    location.hash = '#/pedido/CBX-20261016-ABCDEF';
    await vi.waitFor(() => expect($('#pedidoBody a[data-view="carrinho"]').textContent).toBe('voltar ao carrinho'));
    expect(saved().pendingSerial).toBe('');
    api.status = 'Aguardando pagamento';
  });

  it('sem Mercado Pago ligado, o pedido vai para a página do pedido', async () => {
    goTo('tcg');
    click('#tcgGrid [data-action="add"][data-id="i3"]');
    goTo('carrinho');
    click('[data-action="dest"][data-v="vault"]');
    click('[data-action="dest"][data-v="send"]');
    await vi.waitFor(() => expect(document.querySelectorAll('.ship-opt')).toHaveLength(2));
    click('[data-action="ship"][data-i="0"]');
    click('[data-action="checkout-open"]');
    await settle();
    api.checkoutUrl = null;
    submit('#formCheckout');
    await vi.waitFor(() => expect(location.hash).toBe('#/pedido/CBX-20261016-ABCDEF'));
    api.checkoutUrl = 'https://mp.test/pagar';
    goTo('carrinho');
  });

  it('guardar no cofre tira o frete; quantidade e remover', async () => {
    goTo('carrinho');
    while (document.querySelector('[data-action="remove"]')) click('[data-action="remove"]');
    goTo('tcg');
    click('#tcgGrid [data-action="add"][data-id="i1"]');
    goTo('carrinho');
    click('[data-action="dest"][data-v="vault"]');
    await settle();
    expect($('#cartBody').textContent).toContain('Tudo vai para o cofre');
    click('[data-action="qty"][data-d="1"]');
    expect($('#toast').textContent).toBe('só 1 un. em estoque');
    click('[data-action="remove"]');
    await settle();
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
    expect($('a[href="/api/auth/google"]')).not.toBeNull();
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
    expect($('a[href="/api/auth/google"]')).not.toBeNull();
    expect(saved()).toMatchObject({ user: null, dex: {}, vault: [], hist: [] });
  });

  it('entrar leva ao Google; a volta com erro avisa na conta', async () => {
    goTo('conta');
    expect($<HTMLAnchorElement>('a[href="/api/auth/google"]').textContent).toContain('entrar com Google');
    expect($('#contaBody').textContent).toContain('termos de uso');
    location.hash = '#/conta/erro-login';
    await vi.waitFor(() => expect($('#lg-msg').textContent).toContain('Não deu para entrar com o Google'));
  });

  it('com sessão, a conta vem do servidor: pedidos, dex salva na conta e cofre real', async () => {
    const { syncSession } = await import('../../src/ui/session');
    const { nav } = await import('../../src/ui/cart');
    const to = vi.spyOn(nav, 'to').mockImplementation(() => {});
    api.account = structuredClone(ACCOUNT);
    await syncSession();
    goTo('conta');
    expect($('#contaBody').textContent).toContain('Olá, ana');
    expect($('#contaBody').textContent).toContain('CBX-20261016-AAAAAA');
    expect($('#contaBody').textContent).not.toContain('#1042');

    goTo('dex');
    click('[data-action="dex"][data-id="m5"][data-st="want"]');
    await vi.waitFor(() => expect(lastSent('/api/dex')).toEqual({ dex: { m2: 'have', m5: 'want' } }));

    goTo('cofre');
    expect($('#cofreBody').textContent).toContain('Blastoise 2/102');
    check('[data-input="vault-select"][data-id="u1"]', true);
    type('#vcep', '20040020');
    submit('#formVFrete');
    await vi.waitFor(() => expect(document.querySelectorAll('#cofreBody .ship-opt')).toHaveLength(2));
    expect(lastSent('/api/shipping/quote')).toEqual({ cep: '20040020', items: [{ id: 'i2', qty: 1 }], owned: true });
    click('[data-action="vault-ship"][data-i="0"]');
    expect($<HTMLInputElement>('#vk-street').value).toBe('Avenida Paulista');
    // O envio do cofre também pede CPF e telefone (nota fiscal e etiqueta), nos campos com id próprio (vk-).
    expect(document.querySelector('#ck-street')).toBeNull();
    type('#vk-cpf', '');
    click('[data-action="vault-pay"]');
    expect($('#vk-msg').textContent).toContain('CPF válido');
    type('#vk-cpf', '52998224725');
    type('#vk-phone', '11999998888');
    type('#vk-number', '');
    click('[data-action="vault-pay"]');
    expect($('#vk-msg').textContent).toContain('número');
    type('#vk-number', '7');
    click('[data-action="vault-pay"]');
    await vi.waitFor(() => expect(to).toHaveBeenCalledWith('https://mp.test/envio'));
    expect(lastSent('/api/vault/ship')).toMatchObject({
      items: ['u1'],
      shipping: { serviceId: 1 },
      contact: { cpf: '529.982.247-25', phone: '(11) 99999-8888' },
      address: { number: '7', cep: '20040020' },
    });
  });

  it('apagar a conta com itens no cofre é recusado; sem itens, apaga', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    goTo('conta');
    click('[data-action="delete-account"]');
    await vi.waitFor(() => expect($('#acc-msg').textContent).toContain('itens no cofre'));
    if (api.account) api.account.vault = [];
    click('[data-action="delete-account"]');
    await vi.waitFor(() => expect($('#contaBody').textContent).toContain('Conta apagada'));
    expect(saved().user).toBeNull();
    confirm.mockRestore();
  });

  it('sessão que expirou tira o usuário real deste navegador', async () => {
    const { syncSession } = await import('../../src/ui/session');
    api.account = structuredClone(ACCOUNT);
    await syncSession();
    api.account = null;
    await syncSession();
    expect(saved()).toMatchObject({ user: null, vault: [] });
    goTo('conta');
    click('[data-action="login-demo"]');
    expect($('#contaBody').textContent).toContain('colecionador demo');
    click('[data-action="logout"]');
  });

  it('lista de avisos vai para a API; encomenda monta o WhatsApp', async () => {
    type('#av-email', 'ruim');
    submit('#formAvisos');
    expect($('#av-msg').textContent).toContain('e-mail válido');
    expect($('#av-email').getAttribute('aria-invalid')).toBe('true');
    type('#av-email', 'a@b.co');
    submit('#formAvisos');
    expect($('#av-msg').textContent).toContain('aceite');
    expect($('#av-email').hasAttribute('aria-invalid')).toBe(false);
    $<HTMLInputElement>('#av-ok').checked = true;
    api.fail = { status: 503, error: 'A lista de avisos ainda não está ligado. Tente mais tarde.' };
    submit('#formAvisos');
    await vi.waitFor(() => expect($('#av-msg [role="alert"]').textContent).toContain('lista de avisos'));
    api.fail = null;
    submit('#formAvisos');
    await vi.waitFor(() => expect($('#av-msg').textContent).toContain('Na lista'));
    expect(lastSent('/api/avisos')).toEqual({ email: 'a@b.co', consent: true });
    expect($<HTMLInputElement>('#av-email').value).toBe('');
    goTo('criar');
    submit('#formEncomenda');
    expect($('#en-msg').textContent).toContain('Descreva');
    $<HTMLTextAreaElement>('#en-desc').value = 'display para 12 cards';
    submit('#formEncomenda');
    expect($('#en-msg').textContent).toContain('WhatsApp da Cubodex ainda não está configurado');
  });

  it('ajuda abre na aba do rodapé e troca de aba', () => {
    click('footer [data-tab="faq"]');
    expect(visible()).toEqual(['v-apoio']);
    expect($('#apoioBody h2').textContent).toBe('faq');
    click('[data-action="apoio-tab"][data-tab="termos"]');
    expect($('#apoioBody h2').textContent).toBe('termos de uso');
    expect($('#apoioTabs [data-tab="termos"]').getAttribute('aria-pressed')).toBe('true');
    expect(location.hash).toBe('#/apoio/termos');
    click('[data-action="apoio-tab"][data-tab="trocas"]');
    expect($('#apoioBody h2').textContent).toBe('trocas e devoluções');
    expect($('#apoioBody').textContent).toContain('7 dias corridos');
  });

  it('botão de modo claro/escuro alterna, diz para onde vai e salva a escolha (#14)', () => {
    const btn = $('#themeBtn');
    expect(document.documentElement.dataset.tema).toBe('escuro');
    expect(btn.getAttribute('aria-label')).toBe('Mudar para o modo claro');
    expect(btn.textContent).toBe('modo claro');
    click('#themeBtn');
    expect(document.documentElement.dataset.tema).toBe('claro');
    expect(btn.textContent).toBe('modo escuro');
    expect(localStorage.getItem('cubodex-proto-tema')).toBe('claro');
    click('#themeBtn');
    expect(document.documentElement.dataset.tema).toBe('escuro');
    expect(document.querySelector('#themer, .proto-bar')).toBeNull();
  });
});
