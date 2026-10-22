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
    api.state.rows.a5 = {
      Nome: { title: [{ plain_text: 'luva' }] },
      Tipo: choice('acessório'),
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
