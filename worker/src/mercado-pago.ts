/** Mercado Pago Checkout Pro (aplicação própria do Cubodex): preferência, consulta de pagamento e assinatura do webhook. */

const API = 'https://api.mercadopago.com';

export interface Charge {
  serial: string;
  title: string;
  goods: number;
  shipping: number;
  payer: { name: string; email: string };
  siteUrl: string;
  /** Itens e quantidades; voltam no pagamento (metadata) para baixar o estoque. */
  items: { id: string; qty: number }[];
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

/** Cria a preferência do Checkout Pro e devolve o link de pagamento. */
export const createCheckout = async (f: typeof fetch, token: string, c: Charge): Promise<string> => {
  const back = `${c.siteUrl}/#/pedido/${c.serial}`;
  const res = await f(`${API}/checkout/preferences`, {
    method: 'POST',
    // Mesmo serial = mesma preferência, se a chamada for repetida.
    headers: { ...auth(token), 'X-Idempotency-Key': c.serial },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      items: [{ id: c.serial, title: c.title, quantity: 1, unit_price: c.goods, currency_id: 'BRL' }],
      shipments: { mode: 'not_specified', cost: c.shipping },
      payer: { name: c.payer.name, email: c.payer.email },
      external_reference: c.serial,
      metadata: { items: c.items },
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      // Sem notification_url aqui: ela teria prioridade sobre o webhook cadastrado no painel do Mercado Pago,
      // e só os avisos do painel vêm assinados com a chave secreta (x-signature) que o Worker confere.
      // O link deixa de valer em 2 h; o pedido não pago é cancelado em 24 h pelo cron.
      expires: true,
      expiration_date_to: new Date(Date.now() + 2 * 3_600_000).toISOString().replace('Z', '+00:00'),
      statement_descriptor: 'CUBODEX',
    }),
  });
  // Só o status: o corpo do erro pode repetir dados do comprador.
  if (!res.ok) throw new Error(`Mercado Pago preferência: ${res.status}`);
  const data = (await res.json()) as { init_point?: string; sandbox_init_point?: string };
  // Credenciais de teste (TEST-…) pagam no ambiente de testes.
  const url = token.startsWith('TEST-') ? (data.sandbox_init_point ?? data.init_point) : data.init_point;
  if (!url) throw new Error('Mercado Pago preferência sem link de pagamento');
  return url;
};

export const getPayment = async (f: typeof fetch, token: string, id: string) => {
  const res = await f(`${API}/v1/payments/${encodeURIComponent(id)}`, {
    headers: auth(token),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Mercado Pago pagamento ${id}: ${res.status}`);
  return (await res.json()) as {
    id: number;
    status: string;
    transaction_amount?: number;
    /** O frete do Checkout Pro vem à parte do transaction_amount. */
    shipping_amount?: number;
    external_reference?: string;
    metadata?: { items?: { id?: unknown; qty?: unknown }[] };
  };
};

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/**
 * Confere o cabeçalho x-signature ("ts=…,v1=…"): HMAC-SHA256 da chave secreta sobre
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Comparação em tempo constante (crypto.subtle.verify).
 */
export const verifySignature = async (
  secret: string,
  header: string | null,
  requestId: string | null,
  dataId: string,
): Promise<boolean> => {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!parts.ts || !/^[0-9a-f]{64}$/i.test(parts.v1 ?? '') || !dataId) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId ?? ''};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, hexToBytes(parts.v1), new TextEncoder().encode(manifest));
};
