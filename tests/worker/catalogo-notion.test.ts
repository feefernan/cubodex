import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStockCache, handle, refreshCatalog } from '../../worker/src/app';
import { readProducts } from '../../worker/src/catalog-db';
import { resetCatalog } from '../catalog';
import { testDb } from './d1';
import { ctx, env, fake, ORDER, req } from './fakes';

let d1: ReturnType<typeof testDb>;
let api: ReturnType<typeof fake>;
const text = (v: string) => ({ rich_text: [{ plain_text: v }] });
const choice = (v: string) => ({ select: { name: v } });
const MINI_AZUL = {
  Nome: { title: [{ plain_text: 'fiozinho azul' }] },
  Tipo: choice('miniatura'),
  Cor: text('#3ED9F0'),
  Raridade: choice('rara'),
  Número: { number: 13 },
  Preço: { number: 31 },
};

afterEach(resetCatalog);
beforeEach(() => {
  clearStockCache();
  d1 = testDb();
  api = fake();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('catálogo vindo só do Notion (2.3)', () => {
  it('a descrição de um produto novo passa do Notion para o D1 e para o /api/catalog', async () => {
    api.state.rows.m13 = MINI_AZUL;
    api.state.rows.k7 = {
      Nome: { title: [{ plain_text: 'caixa de tokens' }] },
      Tipo: choice('peça'),
      Material: text('PETG'),
      Medidas: text('100 × 80 × 40 mm'),
      Impressão: text(''),
      Nota: text('com tampa'),
      Preço: { number: 52 },
    };
    api.state.rows.a6 = {
      Nome: { title: [{ plain_text: 'triple pack' }] },
      Tipo: choice(' Lacrado '),
      Idioma: choice('PT'),
      Série: choice('Equilíbrio Perfeito'),
      Nota: text('3 boosters'),
      Preço: { number: 25 },
    };
    api.state.rows.a5 = {
      Nome: { title: [{ plain_text: 'luva' }] },
      Tipo: choice('acessório'),
      Categoria: choice('luva'),
      Cor: text('azul'),
      Nota: text('macia'),
      Preço: { number: 9 },
    };
    const E = env({ DB: d1.db });
    await refreshCatalog(d1.db, E, api.f);
    const stored = await readProducts(d1.db);
    expect(stored.find((p) => p.id === 'm13')?.def).toEqual({
      kind: 'mini',
      name: 'fiozinho azul',
      n: 13,
      rar: 'rara',
      color: '#3ED9F0',
    });
    expect(stored.find((p) => p.id === 'k7')?.def).toEqual({
      kind: 'craft',
      name: 'caixa de tokens',
      note: 'com tampa',
      spec: [
        ['material', 'PETG'],
        ['medidas', '100 × 80 × 40 mm'],
      ],
    });
    expect(stored.find((p) => p.id === 'a6')?.def).toEqual({
      kind: 'acc',
      name: 'triple pack',
      note: '3 boosters',
      group: 'lacrado',
      lang: 'PT',
      set: 'Equilíbrio Perfeito',
    });
    expect(stored.find((p) => p.id === 'a5')?.def).toEqual({
      kind: 'acc',
      name: 'luva',
      note: 'macia',
      category: 'luva',
      color: 'azul',
    });
    expect(stored.find((p) => p.id === 'pack')?.def).toEqual({ kind: 'pack', discount: 10 });
    expect(stored.find((p) => p.id === 'i1')?.def).toBeUndefined(); // carta: ainda vem do código

    const { products } = await (await handle(req('/api/catalog'), E, ctx, api.f)).json();
    expect(products.find((p: { id: string }) => p.id === 'm13').def).toMatchObject({ kind: 'mini', n: 13 });
  });

  it('um produto que só existe no Notion pode ser pedido: o servidor o conhece sem mudança de código', async () => {
    api.state.rows.m13 = MINI_AZUL;
    const E = env({ DB: d1.db });
    const res = await handle(req('/api/orders', { ...ORDER, items: [{ id: 'm13', qty: 2 }] }), E, ctx, api.f);
    expect(res.status).toBe(201);
    expect((await res.json()).total).toBe(62 + 38.9); // 2 × R$ 31 + frete
  });

  it('descrição inválida no Notion (cor fora do formato) não entra: o produto fica sem descrição', async () => {
    api.state.rows.m13 = { ...MINI_AZUL, Cor: text('red;background:url(x)') };
    const E = env({ DB: d1.db });
    await refreshCatalog(d1.db, E, api.f);
    expect((await readProducts(d1.db)).find((p) => p.id === 'm13')?.def).toBeUndefined();
    const res = await handle(req('/api/orders', { ...ORDER, items: [{ id: 'm13', qty: 1 }] }), E, ctx, api.f);
    expect(res.status).toBe(400); // não existe no catálogo
  });

  it('o pacote usa o desconto do Notion, e sem a linha do pacote ele não se vende', async () => {
    const pack = { id: 'pack-1', qty: 1, pack: ['m1', 'm2', 'm10'] };
    const E = env({ DB: d1.db });
    const total = async () =>
      (await (await handle(req('/api/orders', { ...ORDER, items: [pack] }), E, ctx, api.f)).json()).total;
    expect(await total()).toBe(74.7 + 38.9); // 83 com 10%
    api.state.rows.pack = { 'Desconto do pacote': { number: 20 } };
    await refreshCatalog(d1.db, E, api.f);
    expect(await total()).toBeCloseTo(66.4 + 38.9, 2); // 83 com 20%
    api.state.inactive.add('pack');
    await refreshCatalog(d1.db, E, api.f);
    const off = await handle(req('/api/orders', { ...ORDER, items: [pack] }), E, ctx, api.f);
    expect(off.status).toBe(409); // a linha do pacote sai do carrinho como item que esgotou
  });
});

describe('carta à venda pelo Notion, com os dados do TCGdex (3.3)', () => {
  const seed = () => {
    d1.sqlite
      .prepare(
        "INSERT INTO tcg_sets (id, name, name_pt, serie_id, serie, released, total, official, logo, h) VALUES ('sv03.5', '151', '151', 'sv', 'Scarlet & Violet', '2023-09-22', 207, 165, 'sv/sv03.5', 'h')",
      )
      .run();
    const card = d1.sqlite.prepare(
      'INSERT INTO tcg_cards (id, set_id, local_id, num, name, name_pt, rarity, types, variants, image, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    card.run(
      'sv03.5-100',
      'sv03.5',
      '100',
      100,
      'Kangaskhan ex',
      'Kangaskhan ex PT',
      'Double rare',
      'Colorless',
      'holo',
      'sv/sv03.5/100',
      'h',
    );
    card.run('sv03.5-101', 'sv03.5', '101', 101, 'Sem raridade', null, null, null, null, null, 'h');
  };
  const carta = (tcgdex: string, over: Record<string, unknown> = {}) => ({
    Nome: { title: [{ plain_text: 'qualquer nome' }] },
    Tipo: choice('carta'),
    'Carta TCGdex': text(tcgdex),
    Idioma: choice('PT'),
    Variante: choice('holo'),
    Gradação: text('PSA 9'),
    Preço: { number: 99 },
    ...over,
  });

  it('o Worker junta a linha do Notion com a carta do TCGdex: nome no idioma do item, set, número, imagem, PT', async () => {
    seed();
    api.state.rows.i13 = carta('sv03.5-100');
    api.state.stock.i13 = 3;
    const E = env({ DB: d1.db });
    await refreshCatalog(d1.db, E, api.f);
    const stored = (await readProducts(d1.db)).find((p) => p.id === 'i13');
    expect(stored?.def).toMatchObject({
      kind: 'item',
      lang: 'PT',
      variant: 'holo',
      grade: { co: 'PSA', n: 9 },
      card: {
        id: 'sv03.5-100',
        setId: 'sv03.5',
        setName: '151',
        number: '100',
        total: 165,
        name: 'Kangaskhan ex PT', // item em português mostra o nome em português
        rarity: 'Double rare',
        types: 'Colorless',
        image: 'sv/sv03.5/100',
        pt: true,
      },
    });
    expect(stored?.def).toMatchObject({ created: '2026-10-20T10:00:00.000Z' });
    const { products } = await (await handle(req('/api/catalog'), E, ctx, api.f)).json();
    expect(products.find((p: { id: string }) => p.id === 'i13').def.card.name).toBe('Kangaskhan ex PT');
  });

  it('uma carta que só existe no Notion pode ser pedida; em inglês usa o nome em inglês', async () => {
    seed();
    api.state.rows.i13 = carta('sv03.5-100', { Idioma: choice('EN') });
    api.state.stock.i13 = 3;
    const E = env({ DB: d1.db });
    const res = await handle(
      req('/api/orders', { ...ORDER, items: [{ id: 'i13', qty: 2, dest: 'send' }] }),
      E,
      ctx,
      api.f,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).total).toBe(198 + 38.9);
    const page = api.calls.find((c) => c.url.endsWith('/v1/pages'))?.body.properties as Record<string, unknown>;
    expect(JSON.stringify(page.Itens)).toContain('2× Kangaskhan ex 100/165 (EN · holo · PSA 9)');
    // pedido acima do estoque: 409
    const over = await handle(
      req('/api/orders', { ...ORDER, items: [{ id: 'i13', qty: 4, dest: 'send' }] }),
      E,
      ctx,
      api.f,
    );
    expect(over.status).toBe(409);
  });

  it('carta que não está na enciclopédia fica sem descrição e o log avisa; sem id do TCGdex também', async () => {
    seed();
    api.state.rows.i13 = carta('sv03.5-999');
    api.state.rows.i14 = carta('');
    const E = env({ DB: d1.db });
    await refreshCatalog(d1.db, E, api.f);
    const rows = await readProducts(d1.db);
    expect(rows.find((p) => p.id === 'i13')?.def).toBeUndefined();
    expect(rows.find((p) => p.id === 'i14')?.def).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('não está na enciclopédia'));
  });

  it('carta sem raridade, tipos nem imagem entra do mesmo jeito', async () => {
    seed();
    api.state.rows.i13 = carta('sv03.5-101', { Gradação: text('') });
    const E = env({ DB: d1.db });
    await refreshCatalog(d1.db, E, api.f);
    expect((await readProducts(d1.db)).find((p) => p.id === 'i13')?.def).toMatchObject({
      grade: null,
      card: { name: 'Sem raridade', rarity: '', types: '', image: null },
    });
  });
});
