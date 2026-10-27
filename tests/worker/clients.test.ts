import { describe, expect, it, vi } from 'vitest';
import { quoteShipping } from '../../worker/src/melhor-envio';
import { createCheckout, getPayment, verifySignature } from '../../worker/src/mercado-pago';

const charge = {
  serial: 'CBX-20261016-ABCDEF',
  title: 'Cubodex — 1 item',
  goods: 10,
  shipping: 0,
  payer: { name: 'Ana', email: 'a@b.co' },
  siteUrl: 'https://cubodex.test',
  items: [],
};

describe('Mercado Pago', () => {
  it('credencial de teste paga no sandbox; produção no link normal', async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ init_point: 'https://prod', sandbox_init_point: 'https://sandbox' }),
    );
    expect(await createCheckout(f, 'TEST-123', charge)).toBe('https://sandbox');
    expect(await createCheckout(f, 'APP_USR-1', charge)).toBe('https://prod');
    const init = f.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.back_urls.success).toBe('https://cubodex.test/#/pedido/CBX-20261016-ABCDEF');
    expect(body.expires).toBe(true);
    expect(Date.parse(body.expiration_date_to) - Date.now()).toBeGreaterThan(60 * 60_000);
  });
  it('erro ou resposta sem link viram exceção', async () => {
    await expect(createCheckout(async () => Response.json({}), 'APP_USR-1', charge)).rejects.toThrow('sem link');
    await expect(createCheckout(async () => new Response('x', { status: 400 }), 'APP_USR-1', charge)).rejects.toThrow(
      '400',
    );
    await expect(getPayment(async () => new Response('x', { status: 404 }), 'APP_USR-1', '7')).rejects.toThrow('404');
  });
  it('assinatura válida confere mesmo sem x-request-id', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('k'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('id:abc;request-id:;ts:9;'));
    const v1 = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await verifySignature('k', ` ts=9 , v1=${v1}`, null, 'ABC')).toBe(true);
  });

  it('assinatura mal formada é recusada sem calcular nada', async () => {
    expect(await verifySignature('k', null, null, '1')).toBe(false);
    expect(await verifySignature('k', 'ts=1,v1=zz', 'r', '1')).toBe(false);
    expect(await verifySignature('k', `ts=1,v1=${'a'.repeat(64)}`, 'r', '')).toBe(false);
    expect(await verifySignature('k', `ts=1,v1=${'a'.repeat(64)}`, 'r', '1')).toBe(false);
  });
});

describe('Melhor Envio', () => {
  const env = {
    MELHOR_ENVIO_API: 'https://me',
    MELHOR_ENVIO_TOKEN: 't',
    ORIGIN_CEP: '01403020',
    CONTACT_EMAIL: 'c@d.co',
  };
  it('identifica o app e devolve só cotações válidas, mais baratas primeiro', async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([
        { id: 2, name: 'SEDEX', price: '30.00', delivery_time: 2 },
        { id: 1, name: 'PAC', price: '20.004', delivery_time: 6, company: { name: 'Correios' } },
        { id: 3, name: 'X', error: 'fora da área' },
        { id: 4, name: 'Y' },
      ]),
    );
    const opts = await quoteShipping(f, env, '20040020', [{ id: 'm1', kind: 'mini', qty: 1, price: 22 }]);
    expect(opts).toEqual([
      { id: 1, name: 'PAC', company: 'Correios', price: 20, days: 6 },
      { id: 2, name: 'SEDEX', company: '', price: 30, days: 2 },
    ]);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'User-Agent': 'Cubodex (c@d.co)' });
  });
  it('erro da API vira exceção', async () => {
    await expect(quoteShipping(async () => new Response('x', { status: 401 }), env, '1', [])).rejects.toThrow('401');
  });
});
