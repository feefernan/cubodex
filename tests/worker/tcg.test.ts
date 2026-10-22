import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../worker/src/app';
import { testDb } from './d1';
import { ctx, env, fake, req } from './fakes';

let d1: ReturnType<typeof testDb>;
let api: ReturnType<typeof fake>;

const set = (id: string, name: string, released: string, over: Record<string, unknown> = {}) =>
  d1.sqlite
    .prepare(
      'INSERT INTO tcg_sets (id, name, name_pt, serie_id, serie, released, total, official, logo, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, name, (over.name_pt as string) ?? null, 'sv', 'Scarlet & Violet', released, 10, 8, `sv/${id}`, 'h');
const card = (id: string, setId: string, local: string, name: string, namePt: string | null = null) =>
  d1.sqlite
    .prepare(
      'INSERT INTO tcg_cards (id, set_id, local_id, num, name, name_pt, rarity, types, variants, image, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      setId,
      local,
      /^\d+$/.test(local) ? Number(local) : null,
      name,
      namePt,
      'Rare',
      'Fire',
      'holo',
      `sv/${setId}/${local}`,
      'h',
    );

beforeEach(() => {
  d1 = testDb();
  api = fake();
  set('sv03.5', '151', '2023-09-22', { name_pt: '151' });
  set('sv01', 'Scarlet & Violet', '2023-03-31');
  card('sv03.5-010', 'sv03.5', '010', 'Pidgey');
  card('sv03.5-002', 'sv03.5', '002', 'Ivysaur', 'Ivysaur PT');
  card('sv03.5-TG01', 'sv03.5', 'TG01', 'Trainer Gallery');
  card('sv01-001', 'sv01', '001', 'Sprigatito');
});

const get = (path: string, over = {}) => handle(req(path), env({ DB: d1.db, ...over }), ctx, api.f);

describe('GET /api/tcg', () => {
  it('lista os sets do mais novo ao mais antigo, com cache de 1 hora', async () => {
    const res = await get('/api/tcg/sets');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const { sets } = await res.json();
    expect(sets.map((s: { id: string }) => s.id)).toEqual(['sv03.5', 'sv01']);
    expect(sets[0]).toMatchObject({ name: '151', name_pt: '151', serie: 'Scarlet & Violet', logo: 'sv/sv03.5' });
  });

  it('o set traz as cartas pelo número, com as de número em texto no fim', async () => {
    const { set: s, cards } = await (await get('/api/tcg/sets/sv03.5')).json();
    expect(s.id).toBe('sv03.5');
    expect(cards.map((c: { id: string }) => c.id)).toEqual(['sv03.5-002', 'sv03.5-010', 'sv03.5-TG01']);
    expect(cards[0]).toMatchObject({ name: 'Ivysaur', name_pt: 'Ivysaur PT', rarity: 'Rare', image: 'sv/sv03.5/002' });
    expect((await get('/api/tcg/sets/nao-existe')).status).toBe(404);
  });

  it('a carta vem com o set dela', async () => {
    const { card: c, set: s } = await (await get('/api/tcg/cards/sv03.5-010')).json();
    expect(c).toMatchObject({ id: 'sv03.5-010', set_id: 'sv03.5', name: 'Pidgey' });
    expect(s).toMatchObject({ id: 'sv03.5', total: 10, official: 8 });
    expect((await get('/api/tcg/cards/sv03.5-999')).status).toBe(404);
  });

  it('o índice traz só id, nome, nome em português e set, em listas curtas', async () => {
    const res = await get('/api/tcg/index');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const { cards } = await res.json();
    expect(cards).toHaveLength(4);
    expect(cards).toContainEqual(['sv03.5-002', 'Ivysaur', 'Ivysaur PT', 'sv03.5']);
    expect(cards).toContainEqual(['sv01-001', 'Sprigatito', '', 'sv01']);
  });

  it('id mal formado ou com escape inválido: 404; caminho desconhecido: 404; sem banco: 503; só GET', async () => {
    expect((await get('/api/tcg/cards/a b')).status).toBe(404);
    expect((await get('/api/tcg/cards/%E0%A4%A')).status).toBe(404);
    expect((await get('/api/tcg/outra')).status).toBe(404);
    expect((await get('/api/tcg/sets', { DB: undefined })).status).toBe(503);
    const post = new Request('https://cubodex.test/api/tcg/sets', { method: 'POST' });
    expect((await handle(post, env({ DB: d1.db }), ctx, api.f)).status).toBe(404);
  });

  it('limite por IP só nos pedidos que chegam ao banco', async () => {
    const blocked = { limit: async () => ({ success: false }) };
    expect((await get('/api/tcg/sets', { QUOTES_LIMITER: blocked })).status).toBe(429);
  });

  it('com a Cache API, o segundo pedido não toca o banco', async () => {
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
      const E = env({ DB: d1.db });
      const prepare = vi.spyOn(d1.db, 'prepare');
      await handle(req('/api/tcg/sets'), E, c, api.f);
      await Promise.all(waits);
      const reads = prepare.mock.calls.length;
      expect(reads).toBeGreaterThan(0);
      expect((await handle(req('/api/tcg/sets'), E, c, api.f)).status).toBe(200);
      expect(prepare.mock.calls.length).toBe(reads);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
