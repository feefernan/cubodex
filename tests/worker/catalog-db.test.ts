import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockRow } from '../../src/domain/stock';
import { clearStockCache, handle, refreshCatalog, scheduled } from '../../worker/src/app';
import { flushStock, readProducts, syncProducts, takeStock } from '../../worker/src/catalog-db';
import { testDb } from './d1';
import { ctx, env, fake, req } from './fakes';

let d1: ReturnType<typeof testDb>;
let api: ReturnType<typeof fake>;
const row = (id: string, over: Partial<Omit<StockRow, 'def'> & { pageId: string }> = {}) => ({
  id,
  pageId: `page-${id}`,
  price: null,
  available: 5,
  active: true,
  presale: false,
  ...over,
});
const qty = (id: string) => d1.sqlite.prepare('SELECT qty, dirty FROM products WHERE id = ?').get(id);

beforeEach(() => {
  clearStockCache();
  d1 = testDb();
  api = fake();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('sync Notion → D1', () => {
  it('é idempotente, atualiza preço e estoque e deixa inativo o que sumiu do Notion', async () => {
    await syncProducts(d1.db, [row('a', { price: 10 }), row('b'), row('c', { available: null })], 't1');
    await syncProducts(d1.db, [row('a', { price: 12, available: 9 }), row('b', { active: false })], 't2');
    expect(await readProducts(d1.db)).toEqual([
      { id: 'a', price: 12, available: 9, active: true, presale: false, photos: [] },
      { id: 'b', price: null, available: 5, active: false, presale: false, photos: [] },
      { id: 'c', price: null, available: null, active: false, presale: false, photos: [] }, // sumiu do Notion
    ]);
  });

  it('um Notion vazio ou fora do ar não esvazia a loja', async () => {
    await syncProducts(d1.db, [row('a')], 't1');
    expect(await syncProducts(d1.db, [], 't2')).toBe(0);
    expect((await readProducts(d1.db))[0].active).toBe(true);
  });

  it('não desfaz a baixa que o Notion ainda não recebeu', async () => {
    await syncProducts(d1.db, [row('a', { available: 5 })], 't1');
    await takeStock(d1.db, [{ id: 'a', qty: 2 }], 0, async () => {});
    await syncProducts(d1.db, [row('a', { available: 5 })], 't2'); // o Notion ainda mostra 5
    expect(qty('a')).toEqual({ qty: 3, dirty: 1 });
  });
});

describe('baixa de estoque atômica', () => {
  it('duas vendas da última unidade: uma leva, a outra volta como "sem estoque"', async () => {
    await syncProducts(d1.db, [row('a', { available: 1 })], 't1');
    const done: number[] = [];
    const first = await takeStock(d1.db, [{ id: 'a', qty: 1 }], 0, async (n) => void done.push(n));
    const second = await takeStock(d1.db, [{ id: 'a', qty: 1 }], 0, async (n) => void done.push(n));
    expect([first, second, done]).toEqual([[], ['a'], [1, 1]]);
    expect(qty('a')).toEqual({ qty: 0, dirty: 1 });
  });

  it('retoma de onde parou, e ignora peça sem controle de estoque e produto fora da tabela', async () => {
    await syncProducts(d1.db, [row('a', { available: 4 }), row('p', { available: null })], 't1');
    const items = [
      { id: 'a', qty: 1 },
      { id: 'p', qty: 3 },
      { id: 'x', qty: 1 },
      { id: 'a', qty: 2 },
    ];
    const short = await takeStock(d1.db, items, 1, async () => {});
    expect(short).toEqual([]);
    expect(qty('a')).toEqual({ qty: 2, dirty: 1 }); // a primeira linha (from = 1) já tinha sido baixada antes
    expect(qty('p')).toEqual({ qty: null, dirty: 0 });
  });
});

describe('gravar a baixa no Notion', () => {
  it('grava o estoque e limpa a pendência; falha do Notion deixa pendente para a próxima rodada', async () => {
    await syncProducts(d1.db, [row('i2', { available: 2 })], 't1');
    await takeStock(d1.db, [{ id: 'i2', qty: 1 }], 0, async () => {});
    const down = vi.fn(async () => new Response('fora', { status: 500 }));
    expect(await flushStock(d1.db, down, 'tok')).toBe(0);
    expect(qty('i2')).toEqual({ qty: 1, dirty: 1 });
    expect(await flushStock(d1.db, api.f, 'tok')).toBe(1);
    expect(api.state.stock.i2).toBe(1);
    expect(qty('i2')).toEqual({ qty: 1, dirty: 0 });
  });

  it('uma venda no meio da gravação deixa o produto pendente (o valor gravado já é velho)', async () => {
    await syncProducts(d1.db, [row('i2', { available: 3 })], 't1');
    await takeStock(d1.db, [{ id: 'i2', qty: 1 }], 0, async () => {});
    const racing = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await takeStock(d1.db, [{ id: 'i2', qty: 1 }], 0, async () => {}); // outra venda durante o PATCH
      return api.f(input, init);
    });
    await flushStock(d1.db, racing as unknown as typeof fetch, 'tok');
    expect(qty('i2')).toEqual({ qty: 1, dirty: 1 });
  });
});

describe('catálogo servido pelo D1', () => {
  it('na primeira vez busca do Notion; depois o site e o servidor leem só o D1', async () => {
    const E = env({ DB: d1.db });
    const first = await (await handle(req('/api/catalog'), E, ctx, api.f)).json();
    expect(first.products.find((p: { id: string }) => p.id === 'i2')).toMatchObject({ available: 2, active: true });
    const notionCalls = () => api.calls.filter((c) => c.url.includes('/databases/db-produtos')).length;
    const before = notionCalls();
    await handle(req('/api/catalog'), E, ctx, api.f);
    expect(notionCalls()).toBe(before);
    // A edição no Notion só chega no próximo sync.
    api.state.stock.i2 = 7;
    expect(
      (await (await handle(req('/api/catalog'), E, ctx, api.f)).json()).products.find(
        (p: { id: string }) => p.id === 'i2',
      ).available,
    ).toBe(2);
    await refreshCatalog(d1.db, E, api.f);
    expect(
      (await (await handle(req('/api/catalog'), E, ctx, api.f)).json()).products.find(
        (p: { id: string }) => p.id === 'i2',
      ).available,
    ).toBe(7);
  });

  it('sem Notion configurado o sync não faz nada, e o cron roda o sync (só com banco)', async () => {
    expect(await refreshCatalog(d1.db, { NOTION_TOKEN: undefined, NOTION_PRODUCTS_DB: 'x' }, api.f)).toBe(0);
    const waits: Promise<unknown>[] = [];
    const run = (e: ReturnType<typeof env>) =>
      scheduled(e, { waitUntil: (p: Promise<unknown>) => void waits.push(p) }, api.f);
    run(env());
    expect(waits).toHaveLength(0);
    run(env({ DB: d1.db }));
    await Promise.all(waits);
    expect((await readProducts(d1.db)).length).toBeGreaterThan(30);
  });
});
