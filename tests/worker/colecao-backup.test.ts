import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startSession } from '../../worker/src/accounts';
import { handle, scheduled } from '../../worker/src/app';
import { backupColecao, listBackups, restoreBackup } from '../../worker/src/colecao-backup';
import type { Env } from '../../worker/src/env';
import { testDb } from './d1';
import { ctx, env } from './fakes';
import { memoryBucket } from './r2';

let d1: ReturnType<typeof testDb>;
let r2: ReturnType<typeof memoryBucket>;
let E: Env;
const NOW = new Date('2026-11-15T12:00:00Z');
const KEY = (id: string) => `backups/colecao/${id}.json`;
const rows = (sql: string) => d1.sqlite.prepare(sql).all() as Record<string, unknown>[];
const items = () => rows('SELECT card_id, variant, qty FROM col_items ORDER BY card_id, variant');
const own = (list: [string, string, number][]) => {
  for (const [c, v, q] of list)
    d1.sqlite
      .prepare("INSERT INTO col_items (card_id, variant, qty, updated_at, updated_by) VALUES (?, ?, ?, 'x', 'x')")
      .run(c, v, q);
};
const put = (id: string, body: unknown, uploaded?: Date) => {
  r2.objects.set(KEY(id), {
    body: new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer,
    type: 'application/json',
  });
  if (uploaded) r2.uploaded.set(KEY(id), uploaded);
};

beforeEach(() => {
  d1 = testDb();
  r2 = memoryBucket();
  E = env({ DB: d1.db, FOTOS: r2.bucket, OWNER_EMAILS: 'dono@exemplo.com' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('cópia diária', () => {
  it('grava uma vez por dia, com contagens, e não grava coleção vazia', async () => {
    expect(await backupColecao(d1.db, r2.bucket, NOW)).toBe(false);
    expect(r2.objects.size).toBe(0);
    own([
      ['base1-4', 'holo', 2],
      ['base1-5', 'normal', 1],
    ]);
    expect(await backupColecao(d1.db, r2.bucket, NOW)).toBe(true);
    expect(await backupColecao(d1.db, r2.bucket, new Date('2026-11-15T20:00:00Z'))).toBe(false);
    expect(r2.objects.size).toBe(1);
    expect(r2.objects.get(KEY('2026-11-15'))?.meta).toMatchObject({ cards: '2', units: '3' });
    expect(await listBackups(r2.bucket)).toEqual([
      { id: '2026-11-15', at: NOW.toISOString(), cards: 2, units: 3, kind: 'dia' },
    ]);
  });

  it('apaga as cópias com mais de 30 dias e ignora arquivos de outro formato', async () => {
    own([['base1-4', 'holo', 1]]);
    put('2026-09-01', { items: [] }, new Date('2026-09-01T00:00:00Z'));
    put('2026-11-10', { items: [] }, new Date('2026-11-10T00:00:00Z'));
    put('lixo', {}, new Date('2026-11-10T00:00:00Z'));
    await backupColecao(d1.db, r2.bucket, NOW);
    expect([...r2.objects.keys()].sort()).toEqual([KEY('2026-11-10'), KEY('2026-11-15'), KEY('lixo')]);
    expect((await listBackups(r2.bucket)).map((b) => b.id)).toEqual(['2026-11-15', '2026-11-10']);
  });

  it('o cron grava a cópia quando há balde, e falha dela não derruba o resto', async () => {
    own([['base1-4', 'holo', 1]]);
    const waits: Promise<unknown>[] = [];
    scheduled(E, { waitUntil: (p) => void waits.push(p) }, (async () => new Response('{}')) as typeof fetch);
    await Promise.all(waits);
    expect(r2.objects.has(`backups/colecao/${new Date().toISOString().slice(0, 10)}.json`)).toBe(true);
    const broken = { ...r2.bucket, head: async () => Promise.reject(new Error('r2')) };
    const w2: Promise<unknown>[] = [];
    scheduled(
      { ...E, FOTOS: broken },
      { waitUntil: (p) => void w2.push(p) },
      (async () => new Response('{}')) as typeof fetch,
    );
    await expect(Promise.all(w2)).resolves.toBeDefined();
  });
});

describe('restaurar', () => {
  it('troca a coleção pela cópia e guarda a de antes para desfazer', async () => {
    own([['base1-4', 'holo', 5]]);
    put('2026-11-14', {
      v: 1,
      items: [
        ['base1-5', 'normal', 2],
        ['base1-4', 'normal', 1],
      ],
    });
    const res = await restoreBackup(d1.db, r2.bucket, 'dono@exemplo.com', '2026-11-14', NOW);
    expect(res).toEqual({ restored: 2, saved: 'antes-restaurar-20261115T120000Z' });
    expect(items()).toEqual([
      { card_id: 'base1-4', variant: 'normal', qty: 1 },
      { card_id: 'base1-5', variant: 'normal', qty: 2 },
    ]);
    expect(rows('SELECT DISTINCT updated_by FROM col_items')).toEqual([{ updated_by: 'dono@exemplo.com' }]);
    // A coleção anterior ficou guardada e dá para voltar a ela.
    await restoreBackup(d1.db, r2.bucket, 'dono@exemplo.com', res.saved, new Date('2026-11-15T12:05:00Z'));
    expect(items()).toEqual([{ card_id: 'base1-4', variant: 'holo', qty: 5 }]);
  });

  it('cópia danificada, inexistente ou id inválido não mexe na coleção', async () => {
    own([['base1-4', 'holo', 5]]);
    const before = items();
    const go = (id: unknown) => restoreBackup(d1.db, r2.bucket, 'a@b.c', id, NOW);
    await expect(go('2026-11-01')).rejects.toMatchObject({ status: 404 });
    await expect(go('../fotos')).rejects.toMatchObject({ status: 400 });
    await expect(go(7)).rejects.toMatchObject({ status: 400 });
    for (const [i, bad] of [
      { items: 'x' },
      { items: [] },
      { items: [['base1-4', 'holo', 0]] },
      { items: [['base1-4', 'holo', 1.5]] },
      { items: [['base1-4', 'holo', 1000]] },
      { items: [['base1-4', 'ho lo', 1]] },
      { items: [['', 'holo', 1]] },
      { items: [null] },
      {
        items: [
          ['base1-5', 'normal', 1],
          ['base1-4', 7, 1],
        ],
      },
    ].entries()) {
      put(`2026-10-0${i + 1}`, bad);
      await expect(go(`2026-10-0${i + 1}`)).rejects.toMatchObject({ status: 422 });
    }
    r2.objects.set(KEY('2026-10-20'), {
      body: new TextEncoder().encode('não é json').buffer as ArrayBuffer,
      type: 'x',
    });
    await expect(go('2026-10-20')).rejects.toMatchObject({ status: 422 });
    expect(items()).toEqual(before);
    expect([...r2.objects.keys()].some((k) => k.includes('antes-restaurar'))).toBe(false);
  });

  it('com a coleção vazia restaura sem criar cópia "antes"', async () => {
    put('2026-11-14', { items: [['base1-5', 'normal', 2]] });
    expect(await restoreBackup(d1.db, r2.bucket, 'a@b.c', '2026-11-14', NOW)).toEqual({ restored: 1, saved: null });
  });
});

describe('rotas', () => {
  const login = async (email: string) => ({ Cookie: `cbx_sess=${await startSession(d1.db, email, '')}` });
  const call = (
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string>; env?: Env } = {},
  ) =>
    handle(
      new Request(`https://cubodex.test${path}`, {
        method: init.method ?? 'GET',
        headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      init.env ?? E,
      ctx,
    );

  it('só o dono lista e restaura', async () => {
    own([['base1-4', 'holo', 1]]);
    await backupColecao(d1.db, r2.bucket, NOW);
    const id = (await listBackups(r2.bucket))[0].id;
    const out = await login('fora@exemplo.com');
    expect((await call('/api/colecao/backups', { headers: out })).status).toBe(404);
    expect((await call('/api/colecao/backups/restaurar', { method: 'POST', body: { id }, headers: out })).status).toBe(
      404,
    );
    const dono = await login('dono@exemplo.com');
    const list = await (await call('/api/colecao/backups', { headers: dono })).json();
    expect(list).toMatchObject({ enabled: true, backups: [{ id, cards: 1, units: 1 }] });
    d1.sqlite.exec('DELETE FROM col_items');
    const res = await call('/api/colecao/backups/restaurar', { method: 'POST', body: { id }, headers: dono });
    expect(await res.json()).toEqual({ restored: 1, saved: null });
    expect(items()).toEqual([{ card_id: 'base1-4', variant: 'holo', qty: 1 }]);
    const bad = await call('/api/colecao/backups/restaurar', { method: 'POST', body: { id: 'x' }, headers: dono });
    expect(bad.status).toBe(400);
  });

  it('sem balde R2 a lista vem vazia e restaurar responde 503', async () => {
    const dono = await login('dono@exemplo.com');
    const off = { ...E, FOTOS: undefined };
    expect(await (await call('/api/colecao/backups', { headers: dono, env: off })).json()).toEqual({
      enabled: false,
      backups: [],
    });
    const res = await call('/api/colecao/backups/restaurar', {
      method: 'POST',
      body: { id: '2026-11-14' },
      headers: dono,
      env: off,
    });
    expect(res.status).toBe(503);
  });
});
