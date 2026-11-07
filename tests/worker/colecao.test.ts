import { beforeEach, describe, expect, it } from 'vitest';
import { startSession } from '../../worker/src/accounts';
import { handle } from '../../worker/src/app';
import type { Env } from '../../worker/src/env';
import { testDb } from './d1';
import { ctx, env } from './fakes';

let d1: ReturnType<typeof testDb>;
let E: Env;

beforeEach(() => {
  d1 = testDb();
  E = env({ DB: d1.db, OWNER_EMAILS: 'Dono@exemplo.com, socio@exemplo.com' });
  d1.sqlite.exec(`
    INSERT INTO tcg_sets (id, name, serie_id, serie, released, total, official, h) VALUES ('base1', 'Base Set', 'base', 'Base', '1999-01-09', 102, 102, '');
    INSERT INTO tcg_cards (id, set_id, local_id, num, name, variants, h) VALUES
      ('base1-4', 'base1', '4', 4, 'Charizard', 'normal,holo,firstEdition', ''),
      ('base1-5', 'base1', '5', 5, 'Clefairy', NULL, '');`);
});

const login = async (email: string) => ({ Cookie: `cbx_sess=${await startSession(d1.db, email, '')}` });
const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  handle(
    new Request(`https://cubodex.test${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    E,
    ctx,
  );
const put = (path: string, body: unknown, headers: Record<string, string>) =>
  call(path, { method: 'PUT', body, headers });
const rows = (sql: string) => d1.sqlite.prepare(sql).all() as Record<string, unknown>[];

describe('coleção interna: quem pode entrar', () => {
  it('sem login, e-mail fora da lista ou lista vazia dão 404, igual a uma rota que não existe', async () => {
    expect((await call('/api/colecao')).status).toBe(404);
    expect((await call('/api/colecao', { headers: await login('fora@exemplo.com') })).status).toBe(404);
    expect(
      (await put('/api/colecao/item', { cardId: 'base1-4', variant: 'holo', qty: 1 }, await login('fora@exemplo.com')))
        .status,
    ).toBe(404);
    E = env({ DB: d1.db });
    expect((await call('/api/colecao', { headers: await login('dono@exemplo.com') })).status).toBe(404);
    expect(rows('SELECT * FROM col_items')).toEqual([]);
  });

  it('aceita qualquer e-mail da lista, sem diferenciar maiúsculas', async () => {
    expect((await call('/api/colecao', { headers: await login('dono@exemplo.com') })).status).toBe(200);
    expect((await call('/api/colecao', { headers: await login('SOCIO@exemplo.com') })).status).toBe(200);
  });
});

describe('coleção interna: sets e posse', () => {
  it('acompanha e para de acompanhar um set da enciclopédia', async () => {
    const h = await login('dono@exemplo.com');
    expect((await put('/api/colecao/sets/base1', { track: true }, h)).status).toBe(200);
    expect((await put('/api/colecao/sets/base1', { track: true }, h)).status).toBe(200);
    expect(await (await call('/api/colecao', { headers: h })).json()).toEqual({ sets: ['base1'], items: [] });
    expect((await put('/api/colecao/sets/inexistente', { track: true }, h)).status).toBe(404);
    expect((await put('/api/colecao/sets/base1', { track: 'sim' }, h)).status).toBe(400);
    await put('/api/colecao/sets/base1', { track: false }, h);
    expect(rows('SELECT * FROM col_sets')).toEqual([]);
  });

  it('grava, atualiza e remove só a linha da variante, e a sociedade vê a mesma coleção', async () => {
    const dono = await login('dono@exemplo.com');
    expect((await put('/api/colecao/item', { cardId: 'base1-4', variant: 'holo', qty: 1 }, dono)).status).toBe(200);
    await put('/api/colecao/item', { cardId: 'base1-4', variant: 'holo', qty: 3 }, dono);
    await put('/api/colecao/item', { cardId: 'base1-5', variant: 'normal', qty: 1 }, dono);
    const visto = await (await call('/api/colecao', { headers: await login('socio@exemplo.com') })).json();
    expect(visto.items).toEqual(
      expect.arrayContaining([
        ['base1-4', 'holo', 3],
        ['base1-5', 'normal', 1],
      ]),
    );
    expect(rows("SELECT updated_by FROM col_items WHERE card_id = 'base1-4'")).toEqual([
      { updated_by: 'dono@exemplo.com' },
    ]);
    await put('/api/colecao/item', { cardId: 'base1-4', variant: 'holo', qty: 0 }, dono);
    expect(rows('SELECT card_id FROM col_items')).toEqual([{ card_id: 'base1-5' }]);
  });

  it('recusa carta ou variante que a enciclopédia não tem, e quantidade inválida', async () => {
    const h = await login('dono@exemplo.com');
    expect((await put('/api/colecao/item', { cardId: 'nao-existe', variant: 'normal', qty: 1 }, h)).status).toBe(404);
    expect((await put('/api/colecao/item', { cardId: 'base1-4', variant: 'reverse', qty: 1 }, h)).status).toBe(400);
    expect((await put('/api/colecao/item', { cardId: 'base1-5', variant: 'holo', qty: 1 }, h)).status).toBe(400);
    for (const qty of [-1, 1.5, 1000, '2'])
      expect((await put('/api/colecao/item', { cardId: 'base1-4', variant: 'holo', qty }, h)).status).toBe(400);
    expect(rows('SELECT * FROM col_items')).toEqual([]);
  });

  it('só aceita JSON na escrita (barra formulário de outro site)', async () => {
    const res = await handle(
      new Request('https://cubodex.test/api/colecao/item', {
        method: 'PUT',
        headers: { ...(await login('dono@exemplo.com')), 'Content-Type': 'text/plain' },
        body: '{"cardId":"base1-4","variant":"holo","qty":1}',
      }),
      E,
      ctx,
    );
    expect(res.status).toBe(415);
  });
});
