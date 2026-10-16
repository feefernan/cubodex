import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStockCache, type Env, handle, SUBSCRIBE_CONSENT } from '../../worker/src/app';

const ok = { limit: async () => ({ success: true }) };
const env = (over: Partial<Env> = {}): Env => ({
  SITE_URL: 'https://cubodex.test',
  CONTACT_EMAIL: 'contato@cubodex.test',
  NOTION_PRODUCTS_DB: 'db-produtos',
  NOTION_ORDERS_DB: 'db-pedidos',
  NOTION_SUBSCRIBERS_DB: 'db-avisos',
  MELHOR_ENVIO_API: 'https://me.test',
  ORIGIN_CEP: '01403020',
  ORDERS_LIMITER: ok,
  QUOTES_LIMITER: ok,
  NOTION_TOKEN: 'secret_notion',
  MELHOR_ENVIO_TOKEN: 'me-token',
  MP_ACCESS_TOKEN: 'APP_USR-mp',
  MP_WEBHOOK_SECRET: 'webhook-secret',
  ...over,
});

type Call = { url: string; method: string; body: Record<string, unknown> };

/** Notion, Mercado Pago e Melhor Envio falsos; guardam o que o Worker mandou. */
const fake = () => {
  const calls: Call[] = [];
  const state = {
    orders: [] as { id: string; serial: string; status: string }[],
    subscribers: [] as { id: string; email: string; token: string; out: boolean }[],
    stock: { i2: 2, i9: 10 } as Record<string, number>,
    payment: {
      id: 77,
      status: 'approved',
      external_reference: '',
      metadata: {
        items: [
          { id: 'i2', qty: 1 },
          { id: 'm1', qty: 2 },
        ],
      },
    },
    mpFails: false,
  };
  const reply = (body: unknown, status = 200) => Response.json(body, { status });
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method, body });
    if (url === 'https://me.test/api/v2/me/shipment/calculate')
      return reply([
        { id: 1, name: 'PAC', price: '22.50', delivery_time: 7, company: { name: 'Correios' } },
        { id: 2, name: 'SEDEX', custom_price: '38.90', custom_delivery_time: 3, company: { name: 'Correios' } },
        { id: 3, name: 'Falha', error: 'indisponível' },
      ]);
    if (url === 'https://api.mercadopago.com/checkout/preferences')
      return state.mpFails ? reply({ message: 'erro' }, 500) : reply({ init_point: 'https://mp.test/pagar' });
    if (url.startsWith('https://api.mercadopago.com/v1/payments/')) return reply(state.payment);
    const db = url.match(/databases\/([^/]+)\/query/)?.[1];
    if (db === 'db-produtos') {
      const id = (body.filter as { rich_text?: { equals: string } })?.rich_text?.equals;
      const rows = Object.entries(state.stock)
        .filter(([k]) => !id || k === id)
        .map(([k, n]) => ({
          id: `page-${k}`,
          properties: { ID: { rich_text: [{ plain_text: k }] }, Disponíveis: { number: n }, Preço: { number: null } },
        }));
      return reply({ results: rows });
    }
    if (db === 'db-pedidos') {
      const serial = (body.filter as { title: { equals: string } }).title.equals;
      const found = state.orders.filter((o) => o.serial === serial);
      return reply({
        results: found.map((o) => ({ id: o.id, properties: { Status: { select: { name: o.status } } } })),
      });
    }
    if (db === 'db-avisos') {
      const filter = body.filter as { property: string; title?: { equals: string }; rich_text?: { equals: string } };
      const found = state.subscribers.filter((s) =>
        filter.property === 'Token' ? s.token === filter.rich_text?.equals : s.email === filter.title?.equals,
      );
      return reply({ results: found.map((s) => ({ id: s.id, properties: { Saiu: { checkbox: s.out } } })) });
    }
    if (url === 'https://api.notion.com/v1/pages' && method === 'POST') {
      const props = body.properties as Record<
        string,
        { title?: { text: { content: string } }[]; select?: { name: string } }
      >;
      if ((body.parent as { database_id: string }).database_id === 'db-pedidos')
        state.orders.push({
          id: `p${state.orders.length}`,
          serial: props.Serial.title?.[0].text.content ?? '',
          status: props.Status.select?.name ?? '',
        });
      else
        state.subscribers.push({
          id: `s${state.subscribers.length}`,
          email: props['E-mail'].title?.[0].text.content ?? '',
          token: 't',
          out: false,
        });
      return reply({ id: 'novo' });
    }
    const page = url.match(/pages\/([^/]+)$/)?.[1];
    if (page && method === 'PATCH') {
      const props = body.properties as Record<
        string,
        { select?: { name: string }; number?: number; checkbox?: boolean }
      >;
      const order = state.orders.find((o) => o.id === page);
      if (order && props.Status?.select) order.status = props.Status.select.name;
      if (page.startsWith('page-') && props.Disponíveis) state.stock[page.slice(5)] = props.Disponíveis.number ?? 0;
      const sub = state.subscribers.find((s) => s.id === page);
      if (sub && props.Saiu) sub.out = props.Saiu.checkbox ?? false;
      return reply({ id: page });
    }
    return reply({ error: `rota falsa desconhecida ${method} ${url}` }, 500);
  });
  return { f, calls, state };
};

const req = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://cubodex.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = { waitUntil: () => {} };

const ORDER = {
  items: [
    { id: 'i2', qty: 1 },
    { id: 'm1', qty: 2 },
  ],
  customer: { name: 'Ana Lima', email: 'ana@exemplo.com' },
  address: {
    cep: '01310100',
    street: 'Av. Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    uf: 'SP',
  },
  shipping: { serviceId: 2 },
};

let api: ReturnType<typeof fake>;
beforeEach(() => {
  clearStockCache();
  api = fake();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('rotas básicas', () => {
  it('health, 404 e limite por IP', async () => {
    expect(await (await handle(req('/api/health'), env(), ctx, api.f)).json()).toEqual({ ok: true });
    expect((await handle(req('/api/nada'), env(), ctx, api.f)).status).toBe(404);
    const blocked = env({ QUOTES_LIMITER: { limit: async () => ({ success: false }) } });
    expect((await handle(req('/api/shipping/quote', { cep: '01310100', items: [] }), blocked, ctx, api.f)).status).toBe(
      429,
    );
  });

  it('catálogo vem do Notion; sem token, lista vazia', async () => {
    const res = await handle(req('/api/catalog'), env(), ctx, api.f);
    expect(await res.json()).toEqual({
      products: [
        { id: 'i2', price: null, available: 2, active: true, presale: false },
        { id: 'i9', price: null, available: 10, active: true, presale: false },
      ],
    });
    expect(res.headers.get('Cache-Control')).toContain('max-age=60');
    clearStockCache();
    expect(await (await handle(req('/api/catalog'), env({ NOTION_TOKEN: undefined }), ctx, api.f)).json()).toEqual({
      products: [],
    });
  });
});

describe('frete', () => {
  it('cota no Melhor Envio só o que vai ser enviado', async () => {
    const res = await handle(
      req('/api/shipping/quote', {
        cep: '01310-100',
        items: [
          { id: 'i2', qty: 1, dest: 'vault' },
          { id: 'm1', qty: 2 },
        ],
      }),
      env(),
      ctx,
      api.f,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).options.map((o: { id: number; price: number }) => [o.id, o.price])).toEqual([
      [1, 22.5],
      [2, 38.9],
    ]);
    const call = api.calls.find((c) => c.url.startsWith('https://me.test'));
    expect(call?.body).toMatchObject({ from: { postal_code: '01403020' }, to: { postal_code: '01310100' } });
    expect(((call?.body ?? {}).products as { id: string }[]).map((p) => p.id)).toEqual(['m1']);
  });

  it('recusa CEP inválido, corpo que não é JSON e frete desligado', async () => {
    expect(
      (await handle(req('/api/shipping/quote', { cep: '123', items: ORDER.items }), env(), ctx, api.f)).status,
    ).toBe(400);
    const form = new Request('https://cubodex.test/api/shipping/quote', {
      method: 'POST',
      body: 'cep=1',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect((await handle(form, env(), ctx, api.f)).status).toBe(415);
    const off = await handle(
      req('/api/shipping/quote', { cep: '01310100', items: ORDER.items }),
      env({ ORIGIN_CEP: '' }),
      ctx,
      api.f,
    );
    expect(off.status).toBe(503);
    const vaultOnly = await handle(
      req('/api/shipping/quote', { cep: '01310100', items: [{ id: 'i2', qty: 1, dest: 'vault' }] }),
      env(),
      ctx,
      api.f,
    );
    expect(vaultOnly.status).toBe(400);
  });
});

describe('pedido', () => {
  it('recalcula, recota, cria a cobrança e grava no Notion', async () => {
    const res = await handle(req('/api/orders', { ...ORDER, items: [...ORDER.items], total: 1 }), env(), ctx, api.f);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.total).toBe(420 + 44 + 38.9);
    expect(data.checkoutUrl).toBe('https://mp.test/pagar');
    expect(data.serial).toMatch(/^CBX-\d{8}-[A-Z2-9]{6}$/);
    const pref = api.calls.find((c) => c.url.endsWith('/checkout/preferences'))?.body;
    expect(pref).toMatchObject({
      external_reference: data.serial,
      shipments: { cost: 38.9 },
      items: [{ unit_price: 464 }],
      metadata: {
        items: [
          { id: 'i2', qty: 1 },
          { id: 'm1', qty: 2 },
        ],
      },
      statement_descriptor: 'CUBODEX',
    });
    expect(api.state.orders).toEqual([{ id: 'p0', serial: data.serial, status: 'Aguardando pagamento' }]);
    const page = api.calls.find((c) => c.url.endsWith('/v1/pages'))?.body.properties as Record<string, unknown>;
    expect(JSON.stringify(page.Itens)).toContain('2× fiozinho base');
    expect(JSON.stringify(page.Frete)).toContain('Correios SEDEX · 3 dias úteis');
  });

  it('sem Mercado Pago o pedido fica "Novo", sem link de pagamento', async () => {
    const res = await handle(req('/api/orders', ORDER), env({ MP_ACCESS_TOKEN: undefined }), ctx, api.f);
    expect(await res.json()).toMatchObject({ checkoutUrl: null });
    expect(api.state.orders[0].status).toBe('Novo');
  });

  it('frete que sumiu, cobrança que falhou e cofre sem conta não gravam pedido', async () => {
    expect((await handle(req('/api/orders', { ...ORDER, shipping: { serviceId: 9 } }), env(), ctx, api.f)).status).toBe(
      409,
    );
    api.state.mpFails = true;
    expect((await handle(req('/api/orders', ORDER), env(), ctx, api.f)).status).toBe(502);
    const vault = { ...ORDER, items: [{ id: 'i2', qty: 1, dest: 'vault' }] };
    expect((await handle(req('/api/orders', vault), env(), ctx, api.f)).status).toBe(401);
    expect(api.state.orders).toEqual([]);
    expect((await handle(req('/api/orders', ORDER), env({ NOTION_TOKEN: undefined }), ctx, api.f)).status).toBe(503);
  });
});

const sign = async (secret: string, dataId: string, requestId: string, ts: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`id:${dataId};request-id:${requestId};ts:${ts};`),
  );
  return `ts=${ts},v1=${Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

describe('aviso do Mercado Pago', () => {
  const hook = async (secret = 'webhook-secret') =>
    handle(
      req(
        '/api/mp/webhook?data.id=77&type=payment',
        { type: 'payment', data: { id: '77' } },
        {
          'x-signature': await sign(secret, '77', 'req-1', '1700000000'),
          'x-request-id': 'req-1',
        },
      ),
      env(),
      ctx,
      api.f,
    );

  it('pagamento aprovado marca Pago e baixa o estoque só das cartas, uma vez', async () => {
    const created = await (await handle(req('/api/orders', ORDER), env(), ctx, api.f)).json();
    api.state.payment.external_reference = created.serial;
    expect((await hook()).status).toBe(200);
    expect(api.state.orders[0].status).toBe('Pago');
    expect(api.state.stock).toEqual({ i2: 1, i9: 10 });
    await hook();
    expect(api.state.stock.i2).toBe(1);
  });

  it('recusa assinatura inválida e ignora pagamento sem pedido', async () => {
    expect((await hook('outra-chave')).status).toBe(401);
    api.state.payment.external_reference = 'CBX-20261016-AAAAAA';
    expect((await hook()).status).toBe(200);
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('consulta o status pelo serial', async () => {
    const created = await (await handle(req('/api/orders', ORDER), env(), ctx, api.f)).json();
    expect(await (await handle(req(`/api/orders/${created.serial}/status`), env(), ctx, api.f)).json()).toEqual({
      status: 'Aguardando pagamento',
    });
    expect((await handle(req('/api/orders/xyz/status'), env(), ctx, api.f)).status).toBe(404);
    expect((await handle(req('/api/orders/CBX-20261016-AAAAAA/status'), env(), ctx, api.f)).status).toBe(404);
  });
});

describe('lista de avisos', () => {
  it('inscreve com o texto do consentimento, sem duplicar', async () => {
    expect((await handle(req('/api/avisos', { email: 'x', consent: true }), env(), ctx, api.f)).status).toBe(400);
    expect((await handle(req('/api/avisos', { email: 'a@b.co', consent: false }), env(), ctx, api.f)).status).toBe(400);
    expect((await handle(req('/api/avisos', { email: ' A@B.co ', consent: true }), env(), ctx, api.f)).status).toBe(
      201,
    );
    expect(api.state.subscribers.map((s) => s.email)).toEqual(['a@b.co']);
    const created = api.calls.find((c) => c.url.endsWith('/v1/pages'))?.body.properties as Record<string, unknown>;
    expect(JSON.stringify(created.Consentimento)).toContain(SUBSCRIBE_CONSENT);
    expect(JSON.stringify(created.Token)).toMatch(/[0-9a-f]{32}/);
    await handle(req('/api/avisos', { email: 'a@b.co', consent: true }), env(), ctx, api.f);
    expect(api.state.subscribers).toHaveLength(1);
  });

  it('link de saída marca Saiu; token inválido ou desconhecido não', async () => {
    api.state.subscribers.push({ id: 's9', email: 'a@b.co', token: 'f'.repeat(32), out: false });
    const res = await handle(req(`/api/avisos/sair?t=${'f'.repeat(32)}`), env(), ctx, api.f);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('você saiu da lista');
    expect(api.state.subscribers[0].out).toBe(true);
    expect((await handle(req('/api/avisos/sair?t=<x>'), env(), ctx, api.f)).status).toBe(400);
    expect((await handle(req(`/api/avisos/sair?t=${'a'.repeat(32)}`), env(), ctx, api.f)).status).toBe(404);
  });
});

describe('falhas', () => {
  it('Notion ou Melhor Envio fora do ar viram 502 com mensagem para o cliente', async () => {
    const down = vi.fn(async () => new Response('fora', { status: 500 }));
    expect((await handle(req('/api/catalog'), env(), ctx, down)).status).toBe(502);
    clearStockCache();
    const res = await handle(
      req('/api/shipping/quote', { cep: '01310100', items: ORDER.items }),
      env({ NOTION_TOKEN: undefined }),
      ctx,
      down,
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('Tente de novo');
    expect((await handle(req('/api/orders/CBX-20261016-AAAAAA/status'), env(), ctx, down)).status).toBe(502);
    expect((await handle(req(`/api/avisos/sair?t=${'a'.repeat(32)}`), env(), ctx, down)).status).toBe(502);
  });

  it('corpo inválido, grande demais e integrações desligadas', async () => {
    const bad = new Request('https://cubodex.test/api/orders', {
      method: 'POST',
      body: '{x',
      headers: { 'Content-Type': 'application/json' },
    });
    expect((await handle(bad, env(), ctx, api.f)).status).toBe(400);
    const big = req('/api/avisos', { email: 'a@b.co', consent: true, pad: 'x'.repeat(70_000) });
    expect((await handle(big, env(), ctx, api.f)).status).toBe(413);
    expect(
      (
        await handle(
          req('/api/avisos', { email: 'a@b.co', consent: true }),
          env({ NOTION_SUBSCRIBERS_DB: '' }),
          ctx,
          api.f,
        )
      ).status,
    ).toBe(503);
    expect(
      (await handle(req('/api/orders/CBX-20261016-AAAAAA/status'), env({ NOTION_TOKEN: undefined }), ctx, api.f))
        .status,
    ).toBe(503);
    expect((await handle(req('/api/mp/webhook', {}), env({ MP_WEBHOOK_SECRET: undefined }), ctx, api.f)).status).toBe(
      503,
    );
    const blocked = env({ ORDERS_LIMITER: { limit: async () => ({ success: false }) } });
    expect((await handle(req('/api/orders', ORDER), blocked, ctx, api.f)).status).toBe(429);
  });

  it('aviso que não é de pagamento é aceito e ignorado; erro ao consultar pede reenvio', async () => {
    const signed = async (type: string) =>
      req(
        `/api/mp/webhook?data.id=77&type=${type}`,
        {},
        {
          'x-signature': await sign('webhook-secret', '77', 'r', '1'),
          'x-request-id': 'r',
        },
      );
    expect((await handle(await signed('merchant_order'), env(), ctx, api.f)).status).toBe(200);
    const down = vi.fn(async () => new Response('x', { status: 500 }));
    expect((await handle(await signed('payment'), env(), ctx, down)).status).toBe(500);
  });

  it('produtos do Notion sem par no catálogo vão para o log', async () => {
    api.state.stock.zz9 = 1;
    await handle(req('/api/catalog'), env(), ctx, api.f);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('zz9'));
  });
});

describe('detalhes do pedido e da lista', () => {
  it('um item só dá nome à cobrança; complemento vai no endereço; catálogo usa o cache', async () => {
    const one = { ...ORDER, items: [{ id: 'm1', qty: 1 }], address: { ...ORDER.address, complement: 'apto 4' } };
    expect((await handle(req('/api/orders', one), env(), ctx, api.f)).status).toBe(201);
    const pref = api.calls.find((c) => c.url.endsWith('/checkout/preferences'))?.body as { items: { title: string }[] };
    expect(pref.items[0].title).toBe('Cubodex — fiozinho base');
    const page = api.calls.find((c) => c.url.endsWith('/v1/pages'))?.body.properties as Record<string, unknown>;
    expect(JSON.stringify(page.Endereço)).toContain('1000 apto 4');
    const queries = api.calls.filter((c) => c.url.includes('db-produtos')).length;
    await handle(req('/api/catalog'), env(), ctx, api.f);
    expect(api.calls.filter((c) => c.url.includes('db-produtos')).length).toBe(queries);
  });

  it('quem saiu da lista e volta é reinscrito, sem página nova', async () => {
    api.state.subscribers.push({ id: 's1', email: 'a@b.co', token: 't', out: true });
    expect((await handle(req('/api/avisos', { email: 'a@b.co', consent: true }), env(), ctx, api.f)).status).toBe(201);
    expect(api.state.subscribers).toEqual([{ id: 's1', email: 'a@b.co', token: 't', out: false }]);
  });
});
