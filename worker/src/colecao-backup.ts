/**
 * Cópia de segurança da coleção (#80): uma vez por dia, `col_items` vai para o R2 como JSON, com retenção de 30 dias.
 * Restaurar troca a coleção inteira pela cópia (um batch só: tudo ou nada) e antes guarda a coleção atual, então a
 * própria restauração tem volta. O D1 continua sendo a fonte da verdade; isto é a rede de segurança fora dele.
 */
import { MAX_QTY } from '../../src/domain/colecao';
import { OrderError } from '../../src/domain/order';
import type { Db } from './accounts';
import type { Bucket } from './bucket';

const PREFIX = 'backups/colecao/';
const KEEP_MS = 30 * 86_400_000;
/** Teto de linhas de uma cópia lida de volta (a coleção inteira tem na casa das centenas). */
const MAX_ROWS = 20_000;
const CARD_ID = /^[\w.!%-]{1,80}$/;
/** `2026-11-15` (diária) ou `antes-restaurar-20261115T153000Z` (guardada antes de uma restauração). */
const BACKUP_ID = /^(?:\d{4}-\d{2}-\d{2}|antes-restaurar-\d{8}T\d{6}Z)$/;

type Row = [string, string, number];

export interface BackupInfo {
  id: string;
  /** Quando a cópia foi feita (ISO). */
  at: string;
  /** Cartas diferentes e unidades somadas. */
  cards: number;
  units: number;
  kind: 'dia' | 'antes';
}

const readItems = async (db: Db): Promise<Row[]> =>
  (
    await db
      .prepare('SELECT card_id, variant, qty FROM col_items ORDER BY card_id, variant')
      .all<{ card_id: string; variant: string; qty: number }>()
  ).results.map((r): Row => [r.card_id, r.variant, r.qty]);

const store = (bucket: Bucket, id: string, rows: Row[], now: Date) =>
  bucket.put(
    `${PREFIX}${id}.json`,
    new TextEncoder().encode(JSON.stringify({ v: 1, at: now.toISOString(), items: rows })).buffer as ArrayBuffer,
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        at: now.toISOString(),
        cards: String(new Set(rows.map((r) => r[0])).size),
        units: String(rows.reduce((n, r) => n + r[2], 0)),
      },
    },
  );

/** Apaga as cópias com mais de 30 dias. */
const prune = async (bucket: Bucket, now: Date) => {
  const { objects } = await bucket.list({ prefix: PREFIX, limit: 1000 });
  for (const o of objects) if (now.getTime() - o.uploaded.getTime() > KEEP_MS) await bucket.delete(o.key);
};

/**
 * Roda a cada 10 minutos (cron) e só grava a primeira vez do dia (UTC). Coleção vazia não vira cópia: não há o que
 * proteger, e uma cópia vazia do dia não pode tomar o lugar de uma boa. Devolve se gravou.
 */
export const backupColecao = async (db: Db, bucket: Bucket, now = new Date()): Promise<boolean> => {
  const id = now.toISOString().slice(0, 10);
  if (await bucket.head(`${PREFIX}${id}.json`)) return false;
  const rows = await readItems(db);
  if (!rows.length) return false;
  await store(bucket, id, rows, now);
  await prune(bucket, now);
  return true;
};

/** As cópias guardadas, da mais nova para a mais velha. */
export const listBackups = async (bucket: Bucket): Promise<BackupInfo[]> => {
  const { objects } = await bucket.list({ prefix: PREFIX, limit: 1000, include: ['customMetadata'] });
  return objects
    .flatMap((o): BackupInfo[] => {
      const id = o.key.slice(PREFIX.length).replace(/\.json$/, '');
      const m = o.customMetadata ?? {};
      return BACKUP_ID.test(id)
        ? [
            {
              id,
              at: m.at ?? o.uploaded.toISOString(),
              cards: Number(m.cards) || 0,
              units: Number(m.units) || 0,
              kind: id.startsWith('antes-') ? 'antes' : 'dia',
            },
          ]
        : [];
    })
    .sort((a, b) => b.at.localeCompare(a.at));
};

/** Lê e confere uma cópia: o que não tem o formato esperado derruba a restauração inteira, nunca restaura pela metade. */
const readBackup = async (bucket: Bucket, id: string): Promise<Row[]> => {
  const obj = await bucket.get(`${PREFIX}${id}.json`);
  if (!obj?.body) throw new OrderError(404, 'Cópia não encontrada.');
  const data = (await new Response(obj.body).json().catch(() => null)) as { items?: unknown } | null;
  const list = data?.items;
  const damaged = new OrderError(422, 'Essa cópia está danificada e não foi restaurada.');
  if (!Array.isArray(list) || !list.length || list.length > MAX_ROWS) throw damaged;
  const rows = new Map<string, Row>();
  for (const r of list) {
    if (!Array.isArray(r)) throw damaged;
    const [card, variant, qty] = r;
    if (
      typeof card !== 'string' ||
      !CARD_ID.test(card) ||
      typeof variant !== 'string' ||
      !/^\w{1,30}$/.test(variant) ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_QTY
    )
      throw damaged;
    rows.set(`${card}|${variant}`, [card, variant, qty]);
  }
  return [...rows.values()];
};

/** Troca a coleção pela cópia `id`. Antes, guarda a coleção de agora (se houver) para poder desfazer. */
export const restoreBackup = async (
  db: Db,
  bucket: Bucket,
  email: string,
  id: unknown,
  now = new Date(),
): Promise<{ restored: number; saved: string | null }> => {
  if (typeof id !== 'string' || !BACKUP_ID.test(id)) throw new OrderError(400, 'Cópia inválida.');
  const rows = await readBackup(bucket, id);
  const current = await readItems(db);
  let saved: string | null = null;
  if (current.length) {
    saved = `antes-restaurar-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    await store(bucket, saved, current, now);
  }
  await db.batch([
    db.prepare('DELETE FROM col_items'),
    db
      .prepare(
        `INSERT INTO col_items (card_id, variant, qty, updated_at, updated_by)
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), ?, ? FROM json_each(?) WHERE true`,
      )
      .bind(now.toISOString(), email, JSON.stringify(rows)),
  ]);
  return { restored: rows.length, saved };
};
