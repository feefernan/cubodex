import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('coleção interna: aviso em /api/me', () => {
  it('só e-mail da lista recebe colecao: true; os outros e a lista vazia não', async () => {
    const me = async (email: string) => (await (await call('/api/me', { headers: await login(email) })).json()).colecao;
    expect(await me('dono@exemplo.com')).toBe(true);
    expect(await me('SOCIO@exemplo.com')).toBe(true);
    expect(await me('fora@exemplo.com')).toBeUndefined();
    E = env({ DB: d1.db });
    expect(await me('dono@exemplo.com')).toBeUndefined();
  });
});

describe('coleção interna: marcar em lote', () => {
  const mark = (setId: string, body: unknown, headers: Record<string, string>) =>
    put(`/api/colecao/sets/${setId}/marcar`, body, headers);
  const have = () => rows('SELECT card_id, variant, qty FROM col_items ORDER BY card_id, variant');

  it('marca o que falta e não baixa quem já tem mais de uma; desmarca só o pedido', async () => {
    const h = await login('dono@exemplo.com');
    await put('/api/colecao/item', { cardId: 'base1-4', variant: 'normal', qty: 3 }, h);
    const res = await mark(
      'base1',
      {
        on: true,
        items: [
          ['base1-4', 'normal'],
          ['base1-4', 'holo'],
          ['base1-5', 'normal'],
        ],
      },
      h,
    );
    expect(await res.json()).toEqual({ on: true, count: 3 });
    expect(have()).toEqual([
      { card_id: 'base1-4', variant: 'holo', qty: 1 },
      { card_id: 'base1-4', variant: 'normal', qty: 3 },
      { card_id: 'base1-5', variant: 'normal', qty: 1 },
    ]);
    expect(rows("SELECT updated_by FROM col_items WHERE card_id = 'base1-5'")).toEqual([
      { updated_by: 'dono@exemplo.com' },
    ]);

    await mark(
      'base1',
      {
        on: false,
        items: [
          ['base1-4', 'holo'],
          ['base1-5', 'normal'],
        ],
      },
      h,
    );
    expect(have()).toEqual([{ card_id: 'base1-4', variant: 'normal', qty: 3 }]);
  });

  it('ignora carta de outro set, variante que a carta não tem e pares repetidos', async () => {
    const h = await login('dono@exemplo.com');
    d1.sqlite.exec(
      `INSERT INTO tcg_cards (id, set_id, local_id, num, name, variants, h) VALUES ('base2-1', 'base2', '1', 1, 'Outra', 'normal', '')`,
    );
    const res = await mark(
      'base1',
      {
        on: true,
        items: [
          ['base1-5', 'normal'],
          ['base1-5', 'normal'],
          ['base1-5', 'holo'],
          ['base2-1', 'normal'],
          ['nao-existe', 'normal'],
          ['base1-4'],
          'lixo',
          null,
        ],
      },
      h,
    );
    expect(await res.json()).toEqual({ on: true, count: 1 });
    expect(have()).toEqual([{ card_id: 'base1-5', variant: 'normal', qty: 1 }]);
    expect(await (await mark('base1', { on: true, items: [] }, h)).json()).toEqual({ on: true, count: 0 });
  });

  it('um set com 300 cartas e 3 variantes vira uma única escrita no banco', async () => {
    const h = await login('dono@exemplo.com');
    d1.sqlite.exec('BEGIN');
    for (let i = 1; i <= 300; i++)
      d1.sqlite.exec(
        `INSERT INTO tcg_cards (id, set_id, local_id, num, name, variants, h) VALUES ('big-${i}', 'big', '${i}', ${i}, 'C${i}', 'normal,reverse,holo', '')`,
      );
    d1.sqlite.exec('COMMIT');
    const items = Array.from({ length: 300 }, (_, i) =>
      ['normal', 'reverse', 'holo'].map((v) => [`big-${i + 1}`, v]),
    ).flat();
    const prepare = vi.spyOn(d1.db, 'prepare');
    const res = await mark('big', { on: true, items }, h);
    expect(await res.json()).toEqual({ on: true, count: 900 });
    expect(prepare.mock.calls.filter(([sql]) => /col_items/.test(sql))).toHaveLength(1);
    expect(rows('SELECT COUNT(*) AS n FROM col_items')).toEqual([{ n: 900 }]);
    await mark('big', { on: false, items }, h);
    expect(have()).toEqual([]);
  });

  it('recusa pedido inválido, set sem cartas e quem não é da lista', async () => {
    const h = await login('dono@exemplo.com');
    expect((await mark('base1', { on: 'sim', items: [] }, h)).status).toBe(400);
    expect((await mark('base1', { on: true, items: 'x' }, h)).status).toBe(400);
    expect((await mark('base1', { on: true, items: new Array(2001).fill(['base1-4', 'holo']) }, h)).status).toBe(400);
    expect((await mark('vazio', { on: true, items: [['x-1', 'normal']] }, h)).status).toBe(404);
    expect(
      (await mark('base1', { on: true, items: [['base1-4', 'holo']] }, await login('fora@exemplo.com'))).status,
    ).toBe(404);
    expect(have()).toEqual([]);
  });
});
