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
  it('a rota de acompanhar set não existe mais', async () => {
    expect((await put('/api/colecao/sets/base1', { track: true }, await login('dono@exemplo.com'))).status).toBe(404);
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

describe('coleção interna: estoque do Notion de um set', () => {
  const item = (tcgdex: string, lang: string, variant: string, grade: { co: string; n: number } | null = null) =>
    JSON.stringify({ kind: 'item', tcgdex, lang, variant, grade, created: null });
  const product = (id: string, price: number | null, qty: number | null, active: number, def: string | null) =>
    d1.sqlite
      .prepare('INSERT INTO products (id, price, qty, active, def) VALUES (?, ?, ?, ?, ?)')
      .run(id, price, qty, active, def);
  const stock = async (query: string, email = 'dono@exemplo.com') =>
    call(`/api/colecao/estoque${query}`, { headers: await login(email) });

  beforeEach(() => {
    product('p1', 5000, 1, 1, item('base1-4', 'EN', 'holo', { co: 'PSA', n: 8 }));
    product('p2', 20, 3, 1, item('base1-5', 'PT', 'normal'));
    product('p3', 15, 2, 0, item('base1-2', 'EN', 'normal')); // inativa
    product('p4', 15, 0, 1, item('base1-6', 'EN', 'normal')); // esgotada
    product('p5', 30, 1, 1, item('base2-11', 'EN', 'normal')); // outro set
    product(
      'p6',
      40,
      null,
      1,
      JSON.stringify({ kind: 'item', tcgdex: 'base1-6', lang: 'EN', variant: 'normal', grade: null, created: null }),
    ); // sem controle de estoque
    product('p7', 99, 1, 1, JSON.stringify({ kind: 'mini', name: 'Torre', n: 1, rar: 'comum', color: '#112233' }));
    product('p8', 99, 1, 1, '{estragado');
    product('p9', 99, 1, 1, null);
  });

  it('devolve só as cartas ativas e com estoque do set pedido, com idioma, variante, gradação, preço e unidades', async () => {
    const res = await stock('?set=base1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stock: { id: string }[] };
    expect([...body.stock].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'p1', cardId: 'base1-4', lang: 'EN', variant: 'holo', grade: 'PSA 8', price: 5000, available: 1 },
      { id: 'p2', cardId: 'base1-5', lang: 'PT', variant: 'normal', grade: '', price: 20, available: 3 },
      { id: 'p6', cardId: 'base1-6', lang: 'EN', variant: 'normal', grade: '', price: 40, available: null },
    ]);
    expect(await (await stock('?set=base2')).json()).toEqual({
      stock: [{ id: 'p5', cardId: 'base2-11', lang: 'EN', variant: 'normal', grade: '', price: 30, available: 1 }],
    });
    expect(await (await stock('?set=nada')).json()).toEqual({ stock: [] });
  });

  it('GET /api/colecao traz também o estoque de todos os sets, para o total da landing', async () => {
    const res = await call('/api/colecao', { headers: await login('dono@exemplo.com') });
    const { shop } = (await res.json()) as { shop: [string, string, number][] };
    expect(shop.sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ['base1-4', 'holo', 1],
      ['base1-5', 'normal', 3],
      ['base1-6', 'normal', 1], // sem controle de estoque conta como 1
      ['base2-11', 'normal', 1],
    ]);
  });

  it('só e-mail da lista lê o estoque; pedido sem set ou com set inválido é recusado', async () => {
    expect((await stock('?set=base1', 'fora@exemplo.com')).status).toBe(404);
    expect((await call('/api/colecao/estoque?set=base1')).status).toBe(404);
    expect((await stock('')).status).toBe(400);
    expect((await stock('?set=a%20b')).status).toBe(400);
    expect((await stock('?set=base1')).status).toBe(200);
  });
});

describe('coleção interna: ajuste do estoque', () => {
  const def = JSON.stringify({
    kind: 'item',
    tcgdex: 'base1-4',
    lang: 'EN',
    variant: 'holo',
    grade: null,
    created: null,
  });
  const product = (id: string, qty: number | null, active = 1, d: string | null = def) =>
    d1.sqlite
      .prepare('INSERT INTO products (id, price, qty, active, def) VALUES (?, 10, ?, ?, ?)')
      .run(id, qty, active, d);
  const row = (id: string) => d1.sqlite.prepare('SELECT qty, dirty FROM products WHERE id = ?').get(id);
  const adjust = async (id: string, delta: unknown, email = 'dono@exemplo.com') =>
    put(`/api/colecao/estoque/${id}`, { delta }, await login(email));

  beforeEach(() => {
    product('a', 2);
    product('zero', 0);
    product('livre', null);
    product('off', 2, 0);
    product('semdef', 2, 1, null);
    product('cheio', 999);
  });

  it('soma e subtrai uma unidade e marca para o Notion', async () => {
    let res = await adjust('a', -1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'a', available: 1 });
    expect(row('a')).toMatchObject({ qty: 1, dirty: 1 });
    res = await adjust('a', 1);
    expect(await res.json()).toEqual({ id: 'a', available: 2 });
    expect(row('a')).toMatchObject({ qty: 2 });
  });

  it('zera mas não passa de zero nem do limite', async () => {
    expect((await adjust('zero', -1)).status).toBe(409);
    expect(row('zero')).toMatchObject({ qty: 0, dirty: 0 });
    expect((await adjust('cheio', 1)).status).toBe(409);
    expect(row('cheio')).toMatchObject({ qty: 999 });
    expect((await adjust('zero', 1)).status).toBe(200);
  });

  it('estoque acima do teto (vindo do Notion) ainda pode baixar, mas não subir', async () => {
    product('mil', 1001);
    expect(await (await adjust('mil', -1)).json()).toEqual({ id: 'mil', available: 1000 });
    expect((await adjust('mil', 1)).status).toBe(409);
  });

  it('sem controle de estoque, inativo, sem def ou inexistente: não muda e responde 404', async () => {
    for (const id of ['livre', 'off', 'semdef', 'nada']) expect((await adjust(id, 1)).status).toBe(404);
    expect(row('livre')).toMatchObject({ qty: null, dirty: 0 });
  });

  it('só aceita delta 1 ou -1 e só e-mail da lista', async () => {
    for (const d of [0, 2, -5, 1.5, '1', null]) expect((await adjust('a', d)).status).toBe(400);
    expect((await adjust('a', 1, 'fora@exemplo.com')).status).toBe(404);
    expect(row('a')).toMatchObject({ qty: 2, dirty: 0 });
  });
});

describe('coleção interna: registrar troca', () => {
  const def = JSON.stringify({
    kind: 'item',
    tcgdex: 'base1-4',
    lang: 'EN',
    variant: 'holo',
    grade: null,
    created: null,
  });
  const product = (id: string, qty: number | null, active = 1) =>
    d1.sqlite
      .prepare('INSERT INTO products (id, price, qty, active, def) VALUES (?, 50, ?, ?, ?)')
      .run(id, qty, active, def);
  const prod = (id: string) => d1.sqlite.prepare('SELECT qty, dirty FROM products WHERE id = ?').get(id);
  const col = () => d1.sqlite.prepare('SELECT card_id, variant, qty FROM col_items ORDER BY card_id, variant').all();
  const trade = async (body: unknown, email = 'dono@exemplo.com') =>
    call('/api/colecao/troca', { method: 'POST', body, headers: await login(email) });

  beforeEach(() => {
    product('a', 3);
    product('b', 1);
    product('zero', 0);
    product('livre', null);
    product('off', 2, 0);
  });

  it('1 carta por 2: baixa o estoque, soma à coleção, marca para o Notion e guarda o histórico', async () => {
    const res = await trade({
      give: [{ id: 'a', qty: 1 }],
      get: [
        { cardId: 'base1-4', variant: 'holo', qty: 1 },
        { cardId: 'base1-5', variant: 'normal', qty: 2 },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gave: [{ id: 'a', available: 2 }],
      got: [
        { cardId: 'base1-4', variant: 'holo', qty: 1 },
        { cardId: 'base1-5', variant: 'normal', qty: 2 },
      ],
    });
    expect(prod('a')).toMatchObject({ qty: 2, dirty: 1 });
    expect(col()).toEqual([
      { card_id: 'base1-4', variant: 'holo', qty: 1 },
      { card_id: 'base1-5', variant: 'normal', qty: 2 },
    ]);
    const log = rows('SELECT at, by, gave, got FROM col_trades');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ by: 'dono@exemplo.com' });
    expect(JSON.parse(String(log[0]?.gave))[0]).toMatchObject({ id: 'a', qty: 1, price: 50 });
  });

  it('2 por 1, com cartas repetidas somadas e quem já tem na coleção soma por cima', async () => {
    d1.sqlite.exec("INSERT INTO col_items VALUES ('base1-4', 'holo', 3, '', 'x')");
    const res = await trade({
      give: [
        { id: 'a', qty: 2 },
        { id: 'b', qty: 1 },
      ],
      get: [
        { cardId: 'base1-4', variant: 'holo', qty: 1 },
        { cardId: 'base1-4', variant: 'holo', qty: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(prod('a')).toMatchObject({ qty: 1 });
    expect(prod('b')).toMatchObject({ qty: 0 });
    expect(col()).toEqual([{ card_id: 'base1-4', variant: 'holo', qty: 5 }]);
  });

  it('estoque que não cobre: 409 e nada muda, nem o que já podia ser baixado', async () => {
    const res = await trade({
      give: [
        { id: 'a', qty: 1 },
        { id: 'b', qty: 2 },
      ],
      get: [{ cardId: 'base1-4', variant: 'holo', qty: 1 }],
    });
    expect(res.status).toBe(409);
    expect(prod('a')).toMatchObject({ qty: 3, dirty: 0 });
    expect(prod('b')).toMatchObject({ qty: 1, dirty: 0 });
    expect(col()).toEqual([]);
    expect(rows('SELECT id FROM col_trades')).toEqual([]);
  });

  it('produto sem controle, inativo ou inexistente e carta ou variante inválida são recusados sem gravar', async () => {
    const get = [{ cardId: 'base1-4', variant: 'holo', qty: 1 }];
    for (const id of ['livre', 'off', 'nada']) expect((await trade({ give: [{ id, qty: 1 }], get })).status).toBe(404);
    const give = [{ id: 'a', qty: 1 }];
    expect((await trade({ give, get: [{ cardId: 'nada-1', variant: 'normal', qty: 1 }] })).status).toBe(404);
    expect((await trade({ give, get: [{ cardId: 'base1-4', variant: 'foil', qty: 1 }] })).status).toBe(400);
    expect(prod('a')).toMatchObject({ qty: 3, dirty: 0 });
    expect(rows('SELECT id FROM col_trades')).toEqual([]);
  });

  it('pedido malformado e quem não é da lista', async () => {
    const get = [{ cardId: 'base1-4', variant: 'holo', qty: 1 }];
    const give = [{ id: 'a', qty: 1 }];
    for (const bad of [
      {},
      { give: [], get },
      { give, get: [] },
      { give: [{ id: 'a', qty: 0 }], get },
      { give: [{ id: 'a', qty: 1.5 }], get },
      { give: [{ qty: 1 }], get },
      { give, get: [{ cardId: 'base1-4', qty: 1 }] },
      { give: Array.from({ length: 11 }, (_, i) => ({ id: `x${i}`, qty: 1 })), get },
    ])
      expect((await trade(bad)).status).toBe(400);
    expect((await trade({ give, get }, 'fora@exemplo.com')).status).toBe(404);
    expect(prod('a')).toMatchObject({ qty: 3, dirty: 0 });
  });
});
