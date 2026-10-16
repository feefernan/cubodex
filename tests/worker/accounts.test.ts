import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createLoginToken, redeemLoginToken } from '../../worker/src/accounts';
import { clearStockCache, handle } from '../../worker/src/app';
import type { Mailer } from '../../worker/src/email';
import type { Env } from '../../worker/src/env';
import { testDb } from './d1';
import { ctx, env, fake, ORDER, req, sign } from './fakes';

let api: ReturnType<typeof fake>;
let d1: ReturnType<typeof testDb>;
let mail: { send: Mock<Mailer['send']> };
let E: Env;

beforeEach(() => {
  clearStockCache();
  api = fake();
  d1 = testDb();
  mail = { send: vi.fn<Mailer['send']>(async () => ({ messageId: 'm1' })) };
  E = env({ DB: d1.db, EMAIL: mail, EMAIL_FROM: 'entrar@cubodex.test' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** Entra direto pelo banco (o caminho do e-mail tem teste próprio) e devolve o cookie. */
const login = async (email = 'ana@exemplo.com') => {
  const session = await redeemLoginToken(d1.db, await createLoginToken(d1.db, email));
  return { Cookie: `outro=1; cbx_sess=${session}` };
};
const withCookie = (path: string, cookie: Record<string, string>, body?: unknown, method?: string) => {
  const r = req(path, body, cookie);
  return method ? new Request(r, { method }) : r;
};
const rows = (sql: string) => d1.sqlite.prepare(sql).all() as Record<string, unknown>[];

describe('link mágico', () => {
  it('manda o link por e-mail, sem dizer se a conta existe', async () => {
    const res = await handle(req('/api/auth/request', { email: ' Ana@Exemplo.com ' }), E, ctx, api.f);
    expect(await res.json()).toEqual({ ok: true });
    const msg = mail.send.mock.calls[0][0];
    expect(msg).toMatchObject({
      to: 'ana@exemplo.com',
      from: 'entrar@cubodex.test',
      subject: expect.stringContaining('entrar'),
    });
    expect(msg.text).toMatch(/https:\/\/cubodex\.test\/api\/auth\/verify\?t=[0-9a-f]{64}/);
    expect(rows('SELECT email, used FROM login_tokens')).toEqual([{ email: 'ana@exemplo.com', used: 0 }]);
    // Só o hash fica no banco.
    expect(msg.text).not.toContain(String(rows('SELECT hash FROM login_tokens')[0].hash));
  });

  it('e-mail inválido, limite por e-mail e login desligado', async () => {
    expect((await handle(req('/api/auth/request', { email: 'x' }), E, ctx, api.f)).status).toBe(400);
    const limiter = { limit: vi.fn(async ({ key }: { key: string }) => ({ success: !key.startsWith('login:') })) };
    expect(
      (await handle(req('/api/auth/request', { email: 'a@b.co' }), { ...E, QUOTES_LIMITER: limiter }, ctx, api.f))
        .status,
    ).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'login:a@b.co' });
    expect(
      (await handle(req('/api/auth/request', { email: 'a@b.co' }), { ...E, EMAIL_FROM: '' }, ctx, api.f)).status,
    ).toBe(503);
    expect(
      (await handle(req('/api/auth/request', { email: 'a@b.co' }), { ...E, DB: undefined }, ctx, api.f)).status,
    ).toBe(503);
  });

  it('em localhost, sem e-mail configurado, o link vai para o log', async () => {
    const local = new Request('http://localhost:5173/api/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev@exemplo.com' }),
    });
    expect((await handle(local, { ...E, EMAIL_FROM: '' }, ctx, api.f)).status).toBe(200);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/http:\/\/localhost:5173\/api\/auth\/verify\?t=/));
  });

  it('o link abre uma página com botão; só o clique (POST da própria origem) entra', async () => {
    const token = await createLoginToken(d1.db, 'ana@exemplo.com');
    const pageRes = await handle(req(`/api/auth/verify?t=${token}`), E, ctx, api.f);
    expect(await pageRes.text()).toContain(`value="${token}"`);
    expect(rows('SELECT used FROM login_tokens')).toEqual([{ used: 0 }]);
    expect((await handle(req('/api/auth/verify?t=<x>'), E, ctx, api.f)).status).toBe(400);

    const post = (origin: string, t = token) =>
      new Request('https://cubodex.test/api/auth/verify', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `t=${t}`,
      });
    expect((await handle(post('https://malicioso.test'), E, ctx, api.f)).status).toBe(403);
    const ok = await handle(post('https://cubodex.test'), E, ctx, api.f);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('Location')).toBe('/#/conta');
    expect(ok.headers.get('Set-Cookie')).toMatch(
      /^cbx_sess=[0-9a-f]{64}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/,
    );
    const again = await handle(post('https://cubodex.test'), E, ctx, api.f);
    expect(again.headers.get('Location')).toBe('/#/conta/link-expirado');
    const bad = await handle(post('https://cubodex.test', 'x'), E, ctx, api.f);
    expect(bad.headers.get('Location')).toBe('/#/conta/link-expirado');
  });

  it('token vencido não entra', async () => {
    const token = await createLoginToken(d1.db, 'ana@exemplo.com', Date.now() - 16 * 60_000);
    expect(await redeemLoginToken(d1.db, token)).toBeNull();
  });
});

describe('conta', () => {
  it('sem sessão: 401; com sessão: dados da conta, nome a partir do e-mail', async () => {
    expect((await handle(req('/api/me'), E, ctx, api.f)).status).toBe(401);
    expect((await handle(req('/api/me', undefined, { Cookie: 'cbx_sess=zz' }), E, ctx, api.f)).status).toBe(401);
    const cookie = await login();
    expect(await (await handle(withCookie('/api/me', cookie), E, ctx, api.f)).json()).toEqual({
      user: { name: 'ana', email: 'ana@exemplo.com' },
      dex: {},
      vault: [],
      hist: [],
      orders: [],
    });
  });

  it('salva a Dex filtrando o que não existe', async () => {
    const cookie = await login();
    const put = withCookie('/api/dex', cookie, { dex: { m1: 'have', m2: 'talvez', zz: 'want', m3: 'want' } }, 'PUT');
    expect(await (await handle(put, E, ctx, api.f)).json()).toEqual({ dex: { m1: 'have', m3: 'want' } });
    expect((await (await handle(withCookie('/api/me', cookie), E, ctx, api.f)).json()).dex).toEqual({
      m1: 'have',
      m3: 'want',
    });
  });

  it('sair encerra a sessão deste aparelho', async () => {
    const cookie = await login();
    const out = await handle(withCookie('/api/auth/logout', cookie, {}), E, ctx, api.f);
    expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await handle(withCookie('/api/me', cookie), E, ctx, api.f)).status).toBe(401);
  });
});

const hook = async (e: Env) =>
  handle(
    req(
      '/api/mp/webhook?data.id=77&type=payment',
      { type: 'payment' },
      {
        'x-signature': await sign('webhook-secret', '77', 'r', '1'),
        'x-request-id': 'r',
      },
    ),
    e,
    ctx,
    api.f,
  );

describe('cofre', () => {
  const vaultOrder = {
    ...ORDER,
    items: [
      { id: 'i2', qty: 2, dest: 'vault' },
      { id: 'm1', qty: 1 },
    ],
  };

  it('compra com "guardar no cofre" só com conta; pago, o item entra no cofre uma vez', async () => {
    expect((await handle(req('/api/orders', vaultOrder), E, ctx, api.f)).status).toBe(401);
    const cookie = await login();
    const created = await (await handle(withCookie('/api/orders', cookie, vaultOrder), E, ctx, api.f)).json();
    const pref = api.calls.find((c) => c.url.endsWith('/checkout/preferences'))?.body as {
      shipments: { cost: number };
    };
    expect(pref.shipments.cost).toBe(38.9);
    const [order] = rows('SELECT kind, status, vault_json FROM orders');
    expect(order).toMatchObject({ kind: 'compra', status: 'Aguardando pagamento' });
    expect(JSON.parse(String(order.vault_json))).toEqual([
      { id: 'i2', qty: 2, name: 'blastoise 2/102', meta: 'EN · normal' },
    ]);

    api.state.payment.external_reference = created.serial;
    await hook(E);
    await hook(E);
    expect(rows('SELECT product_id, qty, status FROM vault_items')).toEqual([
      { product_id: 'i2', qty: 2, status: 'cofre' },
    ]);
    const me = await (await handle(withCookie('/api/me', cookie), E, ctx, api.f)).json();
    expect(me.hist).toEqual([{ d: expect.any(String), t: 'guardado no cofre · blastoise 2/102 (2 un.)' }]);
    expect(me.orders[0]).toMatchObject({ serial: created.serial, status: 'Pago' });
  });

  it('envio do cofre: cota, cobra o frete e, pago, os itens saem do cofre', async () => {
    const cookie = await login();
    const created = await (await handle(withCookie('/api/orders', cookie, vaultOrder), E, ctx, api.f)).json();
    api.state.payment.external_reference = created.serial;
    await hook(E);
    const [item] = rows('SELECT id FROM vault_items');
    const ship = { items: [item.id], address: ORDER.address, shipping: { serviceId: 1 } };

    expect((await handle(req('/api/vault/ship', ship), E, ctx, api.f)).status).toBe(401);
    expect(
      (await handle(withCookie('/api/vault/ship', cookie, { ...ship, items: ['outro'] }), E, ctx, api.f)).status,
    ).toBe(409);
    expect((await handle(withCookie('/api/vault/ship', cookie, { ...ship, address: {} }), E, ctx, api.f)).status).toBe(
      400,
    );
    expect(
      (await handle(withCookie('/api/vault/ship', cookie, { ...ship, shipping: { serviceId: 9 } }), E, ctx, api.f))
        .status,
    ).toBe(409);

    const res = await handle(withCookie('/api/vault/ship', cookie, ship), E, ctx, api.f);
    expect(res.status).toBe(201);
    const envio = await res.json();
    expect(envio).toMatchObject({ total: 22.5, checkoutUrl: 'https://mp.test/pagar' });
    const pref = api.calls.filter((c) => c.url.endsWith('/checkout/preferences')).at(-1)?.body;
    expect(pref).toMatchObject({
      items: [{ title: 'Cubodex — envio do cofre', unit_price: 22.5 }],
      shipments: { cost: 0 },
    });
    expect(api.state.orders.map((o) => o.serial)).toContain(envio.serial);

    api.state.payment.external_reference = envio.serial;
    await hook(E);
    expect(rows('SELECT status, shipment_serial FROM vault_items')).toEqual([
      { status: 'envio', shipment_serial: envio.serial },
    ]);
    expect((await handle(withCookie('/api/vault/ship', cookie, ship), E, ctx, api.f)).status).toBe(409);
  });

  it('envio do cofre sem Mercado Pago fica desligado', async () => {
    const cookie = await login();
    const ship = { items: ['x'], address: ORDER.address, shipping: { serviceId: 1 } };
    expect(
      (await handle(withCookie('/api/vault/ship', cookie, ship), { ...E, MP_ACCESS_TOKEN: undefined }, ctx, api.f))
        .status,
    ).toBe(503);
  });

  it('pagamento recusado marca o pedido como cancelado na conta', async () => {
    const cookie = await login();
    const created = await (await handle(withCookie('/api/orders', cookie, vaultOrder), E, ctx, api.f)).json();
    api.state.payment = { ...api.state.payment, status: 'rejected', external_reference: created.serial };
    await hook(E);
    expect(rows('SELECT status FROM orders')).toEqual([{ status: 'Cancelado' }]);
    expect(rows('SELECT * FROM vault_items')).toEqual([]);
  });
});

describe('LGPD', () => {
  it('exporta os dados como arquivo', async () => {
    const cookie = await login();
    const res = await handle(withCookie('/api/me/export', cookie), E, ctx, api.f);
    expect(res.headers.get('Content-Disposition')).toContain('minha-conta-cubodex.json');
    expect(await res.json()).toMatchObject({ user: { email: 'ana@exemplo.com' }, createdAt: expect.any(String) });
  });

  it('não apaga conta com itens no cofre; sem eles, apaga tudo e mantém os pedidos sem vínculo', async () => {
    const cookie = await login();
    const created = await (
      await handle(
        withCookie('/api/orders', cookie, { ...ORDER, items: [{ id: 'i2', qty: 1, dest: 'vault' }] }),
        E,
        ctx,
        api.f,
      )
    ).json();
    api.state.payment.external_reference = created.serial;
    await hook(E);
    const del = () => handle(withCookie('/api/me', cookie, {}, 'DELETE'), E, ctx, api.f);
    expect((await del()).status).toBe(409);
    d1.sqlite.exec("UPDATE vault_items SET status = 'enviado'");
    const res = await del();
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(rows('SELECT * FROM users')).toEqual([]);
    expect(rows('SELECT * FROM sessions')).toEqual([]);
    expect(rows('SELECT user_id FROM orders')).toEqual([{ user_id: null }]);
  });
});
