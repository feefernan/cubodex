import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStockCache, handle, refreshCatalog } from '../../worker/src/app';
import { readProducts, syncProducts } from '../../worker/src/catalog-db';
import { photoKey, readPhotos, syncPhotos } from '../../worker/src/photos';
import { testDb } from './d1';
import { ctx, env, fake, req } from './fakes';
import { memoryBucket } from './r2';

let d1: ReturnType<typeof testDb>;
let api: ReturnType<typeof fake>;
let r2: ReturnType<typeof memoryBucket>;
const file = (name: string, path: string, query = 'sig=1') => ({
  name,
  url: `https://files.test/${path}?${query}`,
  internal: true,
});
const keysOf = async (id: string) => (await readPhotos(d1.db)).get(id) ?? [];

beforeEach(() => {
  clearStockCache();
  d1 = testDb();
  api = fake();
  r2 = memoryBucket();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('chave da foto', () => {
  it('a mesma foto dá a mesma chave mesmo com a assinatura do link mudando; foto trocada dá outra', async () => {
    const a = await photoKey('i1', file('frente.JPG', 'ws/aaa/frente.jpg', 'sig=1'));
    const b = await photoKey('i1', file('frente.JPG', 'ws/aaa/frente.jpg', 'sig=OUTRA'));
    const c = await photoKey('i1', file('frente.JPG', 'ws/bbb/frente.jpg'));
    expect(a).toMatch(/^fotos\/i1\/[0-9a-f]{16}\.jpg$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('link externo vale pelo endereço inteiro; só imagens, e só ids simples', async () => {
    const ext = (u: string) => ({ name: 'a.png', url: u, internal: false });
    expect(await photoKey('m1', ext('https://x.test/a.png?v=1'))).not.toBe(
      await photoKey('m1', ext('https://x.test/a.png?v=2')),
    );
    expect(await photoKey('m1', file('nota.pdf', 'ws/x/nota.pdf'))).toBeNull();
    expect(await photoKey('M 1', file('a.png', 'ws/x/a.png'))).toBeNull();
    expect(await photoKey('pack3POR', file('a.png', 'ws/x/a.png'))).toMatch(/^fotos\/pack3POR\/[0-9a-f]{16}\.png$/);
    expect(await photoKey('m1', file('a.jpeg', 'ws/x/a.jpeg'))).toMatch(/\.jpeg$/);
  });
});

describe('cópia para o R2', () => {
  it('copia as fotos novas, guarda a lista na ordem do Notion e não copia de novo', async () => {
    const files = [file('1.jpg', 'ws/1/1.jpg'), file('2.png', 'ws/2/2.png')];
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files }], api.f)).toBe(2);
    const keys = await keysOf('i1');
    expect(keys).toHaveLength(2);
    expect(keys[1]).toMatch(/\.png$/);
    expect(r2.objects.get(keys[0])?.type).toBe('image/jpeg');
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files }], api.f)).toBe(0);
    expect(await keysOf('i1')).toEqual(keys);
  });

  it('no máximo 3 fotos por produto: só as 3 primeiras do Notion são copiadas', async () => {
    const five = [1, 2, 3, 4, 5].map((n) => file(`${n}.jpg`, `ws/${n}/${n}.jpg`));
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: five }], api.f)).toBe(3);
    const keys = await keysOf('i1');
    expect(keys).toHaveLength(3);
    expect(r2.objects.size).toBe(3);
    // A mesma lista na rodada seguinte não copia nem apaga nada.
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: five }], api.f)).toBe(0);
    expect(await keysOf('i1')).toEqual(keys);
  });

  it('foto trocada ou tirada: a lista muda e a cópia velha sai do R2', async () => {
    await syncPhotos(
      d1.db,
      r2.bucket,
      [{ id: 'i1', files: [file('1.jpg', 'ws/1/1.jpg'), file('2.jpg', 'ws/2/2.jpg')] }],
      api.f,
    );
    const [first, second] = await keysOf('i1');
    await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: [file('2.jpg', 'ws/2/2.jpg')] }], api.f);
    expect(await keysOf('i1')).toEqual([second]);
    expect(r2.objects.has(first)).toBe(false);
    await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: [] }], api.f);
    expect(await keysOf('i1')).toEqual([]);
    expect(r2.objects.size).toBe(0);
  });

  it('link vencido, arquivo que não é imagem ou grande demais: a lista do produto não muda', async () => {
    await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: [file('1.jpg', 'ws/1/1.jpg')] }], api.f);
    const before = await keysOf('i1');
    const two = [file('1.jpg', 'ws/1/1.jpg'), file('2.jpg', 'ws/2/2.jpg')];
    api.state.fileType = null; // 403
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: two }], api.f)).toBe(0);
    api.state.fileType = 'text/html';
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: two }], api.f)).toBe(0);
    const huge = (async () =>
      new Response(new Uint8Array(9 * 1024 * 1024), {
        headers: { 'Content-Type': 'image/jpeg' },
      })) as unknown as typeof fetch;
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: two }], huge)).toBe(0);
    const empty = (async () =>
      new Response(new Uint8Array(0), { headers: { 'Content-Type': 'image/jpeg' } })) as unknown as typeof fetch;
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: two }], empty)).toBe(0);
    const boom = (async () => {
      throw new Error('rede');
    }) as unknown as typeof fetch;
    expect(await syncPhotos(d1.db, r2.bucket, [{ id: 'i1', files: two }], boom)).toBe(0);
    expect(await keysOf('i1')).toEqual(before);
  });

  it('respeita o limite de cópias por rodada e termina na seguinte', async () => {
    const products = ['a', 'b', 'c'].map((id) => ({ id, files: [file('1.jpg', `ws/${id}/1.jpg`)] }));
    expect(await syncPhotos(d1.db, r2.bucket, products, api.f, 2)).toBe(2);
    expect((await readPhotos(d1.db)).size).toBe(2);
    expect(await syncPhotos(d1.db, r2.bucket, products, api.f, 2)).toBe(1);
    expect((await readPhotos(d1.db)).size).toBe(3);
  });
});

describe('fotos no catálogo e na rota de imagem', () => {
  it('o cron traz as fotos do Notion; /api/catalog as lista e /api/img/<chave> serve do R2', async () => {
    api.state.photos.i2 = [file('carta.jpg', 'ws/c/carta.jpg')];
    const E = env({ DB: d1.db, FOTOS: r2.bucket });
    await refreshCatalog(d1.db, E, api.f);
    const { products } = await (await handle(req('/api/catalog'), E, ctx, api.f)).json();
    const [key] = products.find((p: { id: string }) => p.id === 'i2').photos;
    expect(key).toMatch(/^fotos\/i2\/[0-9a-f]{16}\.jpg$/);
    expect(products.find((p: { id: string }) => p.id === 'i1').photos).toEqual([]);

    const res = await handle(req(`/api/img/${key}`), E, ctx, api.f);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('chave inválida, foto que não existe ou site sem R2 respondem 404', async () => {
    const E = env({ DB: d1.db, FOTOS: r2.bucket });
    expect((await handle(req('/api/img/fotos/i2/0123456789abcdef.jpg'), E, ctx, api.f)).status).toBe(404);
    expect((await handle(req('/api/img/../segredo'), E, ctx, api.f)).status).toBe(404);
    expect((await handle(req('/api/img/fotos/i2/ZZ.jpg'), E, ctx, api.f)).status).toBe(404);
    expect((await handle(req('/api/img/fotos/i2/0123456789abcdef.jpg'), env({ DB: d1.db }), ctx, api.f)).status).toBe(
      404,
    );
  });

  it('a Cache API, quando existe, guarda a resposta e responde da próxima vez', async () => {
    api.state.photos.i2 = [file('carta.jpg', 'ws/c/carta.jpg')];
    const E = env({ DB: d1.db, FOTOS: r2.bucket });
    await refreshCatalog(d1.db, E, api.f);
    const [key] = (await readProducts(d1.db)).find((p) => p.id === 'i2')?.photos ?? [];
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (r: Request) => store.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void store.set(r.url, res),
      },
    });
    try {
      const waits: Promise<unknown>[] = [];
      const c = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
      await handle(req(`/api/img/${key}`), E, c, api.f);
      await Promise.all(waits);
      expect(store.size).toBe(1);
      r2.objects.clear(); // a segunda leitura não precisa do R2
      expect((await handle(req(`/api/img/${key}`), E, c, api.f)).status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uma falha ao copiar fotos não derruba o sync do catálogo', async () => {
    const broken = {
      ...r2.bucket,
      head: async () => {
        throw new Error('R2 fora');
      },
    };
    await syncProducts(d1.db, [], 't0');
    const E = env({ DB: d1.db, FOTOS: broken });
    api.state.photos.i2 = [file('carta.jpg', 'ws/c/carta.jpg')];
    expect(await refreshCatalog(d1.db, E, api.f)).toBeGreaterThan(30);
  });
});
