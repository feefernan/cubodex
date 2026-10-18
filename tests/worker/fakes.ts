/** Notion, Mercado Pago, Melhor Envio e pedidos falsos compartilhados pelos testes do Worker. */
import { vi } from 'vitest';
import type { Env } from '../../worker/src/app';

const ok = { limit: async () => ({ success: true }) };
export const env = (over: Partial<Env> = {}): Env => ({
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
  GOOGLE_CLIENT_ID: '',
  ...over,
});

type Call = { url: string; method: string; body: Record<string, unknown> };

/** Notion, Mercado Pago e Melhor Envio falsos; guardam o que o Worker mandou. */
export const fake = () => {
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

export const req = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://cubodex.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export const ctx = { waitUntil: () => {} };

export const ORDER = {
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

export const sign = async (secret: string, dataId: string, requestId: string, ts: string) => {
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
