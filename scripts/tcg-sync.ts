/**
 * Traz a enciclopédia do TCGdex (sets e cartas, em inglês e os nomes em português) para o D1 do Cubodex.
 * Roda numa Action semanal e quando alguém dispara; só grava o que mudou (hash por linha), então rodar de novo é barato.
 *
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node --experimental-strip-types scripts/tcg-sync.ts [--aplicar]
 *
 * Sem --aplicar, só conta o que gravaria. Sem rede de dados de cliente: só lê o TCGdex e a própria enciclopédia.
 */
import {
  CARD_COLUMNS,
  type CardRow,
  cardRow,
  changed,
  SET_COLUMNS,
  type SetRow,
  setRow,
  upsertSql,
} from '../src/domain/tcgdex.ts';

const APPLY = process.argv.includes('--aplicar');
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const API = 'https://api.tcgdex.net/v2';
const CF = 'https://api.cloudflare.com/client/v4';
if (!TOKEN || !ACCOUNT) {
  console.error('Faltam CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET/POST com algumas tentativas: o TCGdex e a API do Cloudflare às vezes falham uma vez e respondem na seguinte. */
const retry = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (i >= 4) throw new Error(`${what}: ${(e as Error).message}`);
      await sleep(1500 * i);
    }
  }
};

const tcgdex = (path: string, init?: RequestInit) =>
  retry(`TCGdex ${path.split('?')[0]}`, async () => {
    const res = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  });

const graphql = async (query: string) => {
  const data = await tcgdex('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return data.data as Record<string, unknown>;
};

const d1 = async (dbId: string, body: object) =>
  retry('Cloudflare D1', async () => {
    const res = await fetch(`${CF}/accounts/${ACCOUNT}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const out = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { results?: unknown[] }[] };
    if (!res.ok || out.success === false) throw new Error(`${res.status}`);
    return out.result ?? [];
  });

const dbId = await retry('Cloudflare D1', async () => {
  const res = await fetch(`${CF}/accounts/${ACCOUNT}/d1/database?name=cubodex-db`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const out = (await res.json()) as { result?: { uuid: string }[] };
  const id = out.result?.[0]?.uuid;
  if (!id) throw new Error('banco cubodex-db não encontrado');
  return id;
});

const stored = async (table: string) =>
  new Map(
    (((await d1(dbId, { sql: `SELECT id, h FROM ${table}` }))[0]?.results ?? []) as { id: string; h: string }[]).map(
      (r) => [r.id, r.h],
    ),
  );

/** Grava em lotes (a API do D1 limita o tamanho de cada chamada). */
const write = async (table: string, columns: readonly string[], rows: Record<string, unknown>[]) => {
  const sql = upsertSql(table, columns);
  for (let i = 0; i < rows.length; i += 40)
    await d1(dbId, { batch: rows.slice(i, i + 40).map((r) => ({ sql, params: columns.map((c) => r[c] ?? null) })) });
};

// 1. Sets: tudo numa chamada (inglês) + os nomes em português.
const rawSets = ((
  await graphql('{ sets { id name releaseDate logo symbol serie { id name } cardCount { total official } } }')
).sets ?? []) as Record<string, unknown>[];
const ptSets = new Map(
  (((await tcgdex('/pt/sets')) as unknown as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name]),
);
const sets: SetRow[] = rawSets.flatMap((s) => setRow(s, ptSets.get(String(s.id)) ?? null) ?? []);
console.log(`Sets no TCGdex: ${sets.length} (em português: ${sets.filter((s) => s.name_pt).length})`);

// 2. Cartas de cada set: GraphQL (inglês, com raridade e tipos) + REST em português só para o nome.
const cards: CardRow[] = [];
const failed: string[] = [];
const queue = [...sets];
const worker = async () => {
  for (let set = queue.shift(); set; set = queue.shift()) {
    try {
      const pt = new Map<string, string>();
      if (set.name_pt) {
        const detail = (await tcgdex(`/pt/sets/${encodeURIComponent(set.id)}`)) as {
          cards?: { id: string; name: string }[];
        };
        for (const c of detail.cards ?? []) pt.set(c.id, c.name);
      }
      for (let page = 1; ; page++) {
        const data = await graphql(
          `{ cards(filters: { id: ${JSON.stringify(`${set.id}-`)} }, pagination: { page: ${page}, itemsPerPage: 100 }) { id localId name image rarity category types variants { normal reverse holo firstEdition } set { id } } }`,
        );
        const batch = (data.cards ?? []) as Record<string, unknown>[];
        for (const raw of batch) {
          const row = cardRow(raw, set.id, pt.get(String(raw.id)) ?? null);
          if (row) cards.push(row);
        }
        if (batch.length < 100) break;
      }
    } catch (e) {
      failed.push(`${set.id} (${(e as Error).message})`);
    }
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`Cartas no TCGdex: ${cards.length}`);

// 3. Só o que mudou.
const setChanges = changed(sets, await stored('tcg_sets'));
const cardChanges = changed(cards, await stored('tcg_cards'));
console.log(`A gravar: ${setChanges.length} sets e ${cardChanges.length} cartas`);
if (APPLY) {
  await write('tcg_sets', SET_COLUMNS, setChanges);
  await write('tcg_cards', CARD_COLUMNS, cardChanges);
  console.log('Gravado.');
} else console.log('Simulação: nada foi gravado. Rode com --aplicar.');

if (failed.length) {
  console.error(`Sets que falharam (rode de novo): ${failed.join(', ')}`);
  process.exit(1);
}
