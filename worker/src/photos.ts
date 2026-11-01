/**
 * Fotos dos produtos: o dono sobe no Notion (coluna Fotos), o cron copia para o R2 e o site serve do R2.
 * O link do Notion expira em cerca de 1 hora e leva assinatura na query, então a chave é feita só do caminho do
 * arquivo: a mesma foto dá a mesma chave a cada rodada, e uma foto nova ou trocada dá outra.
 */
import { PHOTO_KEY } from '../../src/domain/stock';
import type { Db } from './accounts';
import type { Bucket } from './bucket';
import { log } from './http';
import type { PhotoFile } from './notion';

type Fetch = typeof fetch;

const MAX_BYTES = 8 * 1024 * 1024;
/** Fotos por produto: as 3 primeiras do Notion. O resto não é copiado (limita R2 e o trabalho do cron). */
const MAX_PHOTOS = 3;
const EXT = /\.(jpe?g|png|webp|gif)$/i;
const TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const sha16 = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) =>
    b.toString(16).padStart(2, '0'),
  )
    .join('')
    .slice(0, 16);

/** Chave da foto no R2, ou null se o arquivo não é uma imagem que aceitamos (a extensão vem do nome dado no Notion). */
export const photoKey = async (productId: string, file: PhotoFile): Promise<string | null> => {
  const ext = file.name.match(EXT)?.[1]?.toLowerCase();
  if (!ext || !/^[A-Za-z0-9-]+$/.test(productId)) return null;
  const u = new URL(file.url);
  const identity = file.internal ? `${u.origin}${u.pathname}` : file.url;
  const key = `fotos/${productId}/${await sha16(identity)}.${ext}`;
  return PHOTO_KEY.test(key) ? key : null;
};

/** Copia uma imagem do Notion para o R2; false se não deu (link vencido, não é imagem, grande demais). */
const copy = async (bucket: Bucket, f: Fetch, key: string, file: PhotoFile): Promise<boolean> => {
  try {
    const res = await f(file.url, { signal: AbortSignal.timeout(8000) });
    const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !TYPE_EXT[type]) return false;
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return false;
    await bucket.put(key, body, { httpMetadata: { contentType: type } });
    return true;
  } catch {
    return false;
  }
};

/**
 * Deixa as fotos de cada produto no R2 e a lista no D1. Só troca a lista de um produto quando todas as imagens
 * dele estão no R2; o que não coube nesta rodada (`maxCopies`, para caber no limite de subrequests) fica para a
 * próxima. As cópias que saíram da lista são apagadas depois. Devolve quantas imagens foram copiadas.
 */
export const syncPhotos = async (
  db: Db,
  bucket: Bucket,
  products: { id: string; files: PhotoFile[] }[],
  f: Fetch,
  maxCopies = 20,
) => {
  const stored = await readPhotos(db);
  let copied = 0;
  for (const p of products) {
    const want: { key: string; file: PhotoFile }[] = [];
    for (const file of p.files) {
      const key = await photoKey(p.id, file);
      if (key && !want.some((w) => w.key === key)) want.push({ key, file });
    }
    want.splice(MAX_PHOTOS);
    const keys = want.map((w) => w.key);
    const old = stored.get(p.id) ?? [];
    let complete = true;
    for (const { key, file } of want) {
      if (await bucket.head(key)) continue;
      if (copied >= maxCopies || !(await copy(bucket, f, key, file))) {
        complete = false;
        continue;
      }
      copied++;
    }
    if (!complete) {
      log('warn', 'fotos do produto ainda incompletas', { id: p.id });
      continue;
    }
    if (JSON.stringify(old) === JSON.stringify(keys)) continue;
    await db.batch([
      db.prepare('DELETE FROM photos WHERE product_id = ?').bind(p.id),
      ...keys.map((key, pos) =>
        db.prepare('INSERT INTO photos (product_id, pos, key) VALUES (?, ?, ?)').bind(p.id, pos, key),
      ),
    ]);
    for (const gone of old.filter((k) => !keys.includes(k))) await bucket.delete(gone);
  }
  return copied;
};

/** As fotos de cada produto, na ordem do Notion, para o `/api/catalog`. */
export const readPhotos = async (db: Db): Promise<Map<string, string[]>> => {
  const out = new Map<string, string[]>();
  for (const r of (
    await db
      .prepare('SELECT product_id, key FROM photos ORDER BY product_id, pos')
      .all<{ product_id: string; key: string }>()
  ).results)
    out.set(r.product_id, [...(out.get(r.product_id) ?? []), r.key]);
  return out;
};
