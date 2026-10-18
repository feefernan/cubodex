/**
 * Contas no D1 (#29): link mágico, sessões, Dex, cofre e espelho dos pedidos.
 * Tokens de login e de sessão ficam só como hash SHA-256: quem lê o banco não consegue entrar.
 */
import type { Dex, DexStatus } from '../../src/domain/collection';

/** O pedaço da API do D1 que usamos (os testes usam SQLite com a mesma forma). */
export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Db {
  prepare(sql: string): Stmt;
  batch(statements: Stmt[]): Promise<unknown[]>;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface VaultRow {
  id: string;
  product_id: string;
  name: string;
  meta: string;
  qty: number;
  status: 'cofre' | 'envio' | 'enviado';
  created_at: string;
}

/** Item comprado para guardar no cofre (vai junto do pedido até o pagamento confirmar). */
interface VaultIntent {
  id: string;
  qty: number;
  name: string;
  meta: string;
}

export const SESSION_TTL = 30 * 24 * 60 * 60_000;

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const day = (now: number) =>
  new Date(now).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Abre uma sessão para o e-mail (confirmado pelo Google), criando a conta na primeira vez; devolve o token do cookie. */
export const startSession = async (db: Db, email: string, name: string, now = Date.now()) => {
  await db
    .prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(crypto.randomUUID(), email, name || email.split('@')[0], new Date(now).toISOString())
    .run();
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) return null;
  const session = randomToken();
  await db
    .prepare('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(session), user.id, now + SESSION_TTL)
    .run();
  return session;
};

export const sessionUser = async (db: Db, session: string, now = Date.now()) =>
  db
    .prepare(
      'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires_at > ?',
    )
    .bind(await sha256(session), now)
    .first<User>();

export const endSession = async (db: Db, session: string) =>
  db
    .prepare('DELETE FROM sessions WHERE hash = ?')
    .bind(await sha256(session))
    .run();

export const getAccount = async (db: Db, user: User) => {
  const [dex, vault, hist, orders] = await Promise.all([
    db
      .prepare('SELECT mini_id, status FROM dex WHERE user_id = ?')
      .bind(user.id)
      .all<{ mini_id: string; status: DexStatus }>(),
    db
      .prepare(
        'SELECT id, product_id, name, meta, qty, status, created_at FROM vault_items WHERE user_id = ? ORDER BY created_at DESC',
      )
      .bind(user.id)
      .all<VaultRow>(),
    db
      .prepare('SELECT at, text FROM vault_history WHERE user_id = ? ORDER BY id DESC LIMIT 50')
      .bind(user.id)
      .all<{ at: string; text: string }>(),
    db
      .prepare(
        'SELECT serial, kind, status, total, summary, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      )
      .bind(user.id)
      .all(),
  ]);
  return {
    user: { name: user.name, email: user.email },
    dex: Object.fromEntries(dex.results.map((r) => [r.mini_id, r.status])) as Dex,
    vault: vault.results.map((v) => ({
      id: v.id,
      productId: v.product_id,
      name: v.name,
      meta: v.meta,
      qty: v.qty,
      st: v.status,
      date: day(Date.parse(v.created_at)),
    })),
    hist: hist.results.map((h) => ({ d: h.at, t: h.text })),
    orders: orders.results,
  };
};

/** Troca a Dex inteira do usuário (a Dex é pequena: 12 miniaturas por série). */
export const saveDex = (db: Db, userId: string, dex: Dex) =>
  db.batch([
    db.prepare('DELETE FROM dex WHERE user_id = ?').bind(userId),
    ...Object.entries(dex).map(([mini, st]) =>
      db.prepare('INSERT INTO dex (user_id, mini_id, status) VALUES (?, ?, ?)').bind(userId, mini, st),
    ),
  ]);

/** Item do cofre separado para um envio. */
export type ReservedItem = Pick<VaultRow, 'id' | 'product_id' | 'name' | 'meta' | 'qty'>;

const DAY = 24 * 60 * 60_000;

/**
 * Separa itens do cofre para um envio (#39): só os que estão no cofre e livres — ou presos a um envio de mais de
 * um dia que não foi pago (carrinho abandonado no Mercado Pago). Devolve os separados; se faltar algum, desfaz.
 */
export const reserveForShipment = async (db: Db, userId: string, ids: string[], serial: string, now = Date.now()) => {
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const stale = new Date(now - DAY).toISOString();
  const { results } = await db
    .prepare(
      `UPDATE vault_items SET shipment_serial = ? WHERE user_id = ? AND status = 'cofre' AND id IN (${marks})
       AND (shipment_serial IS NULL OR shipment_serial IN
         (SELECT serial FROM orders WHERE kind = 'envio' AND status <> 'Pago' AND created_at < ?))
       RETURNING id, product_id, name, meta, qty`,
    )
    .bind(serial, userId, ...ids, stale)
    .all<ReservedItem>();
  if (results.length !== ids.length) {
    await releaseShipment(db, serial);
    return null;
  }
  return results;
};

/** Devolve ao cofre os itens separados para um envio que não vai acontecer (cobrança falhou ou foi recusada). */
export const releaseShipment = (db: Db, serial: string) =>
  db
    .prepare("UPDATE vault_items SET shipment_serial = NULL WHERE shipment_serial = ? AND status = 'cofre'")
    .bind(serial)
    .run();

export interface OrderMirror {
  serial: string;
  userId: string | null;
  kind: 'compra' | 'envio';
  status: string;
  total: number;
  summary: string;
  /** compra: itens a guardar no cofre; envio: ids dos itens do cofre. */
  vault: VaultIntent[] | string[];
  /** Cartas a baixar do estoque quando o pagamento confirmar. */
  stock?: { id: string; qty: number }[];
}

export const recordOrder = (db: Db, o: OrderMirror, now = Date.now()) =>
  db
    .prepare(
      'INSERT INTO orders (serial, user_id, kind, status, total, summary, vault_json, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      o.serial,
      o.userId,
      o.kind,
      o.status,
      o.total,
      o.summary,
      JSON.stringify(o.vault),
      JSON.stringify(o.stock ?? []),
      new Date(now).toISOString(),
    )
    .run();

export interface OrderRow {
  user_id: string | null;
  kind: 'compra' | 'envio';
  status: string;
  total: number;
  vault_json: string;
  items_json: string;
  stock_done: number;
  vault_done: number;
}

export const getOrder = (db: Db, serial: string) =>
  db
    .prepare(
      'SELECT user_id, kind, status, total, vault_json, items_json, stock_done, vault_done FROM orders WHERE serial = ?',
    )
    .bind(serial)
    .first<OrderRow>();

/** Marca como Pago só se ainda não estava (Pago ou Estornado). true = esta chamada fez a passagem. */
export const claimPaid = async (db: Db, serial: string) =>
  !!(await db
    .prepare(
      "UPDATE orders SET status = 'Pago' WHERE serial = ? AND status NOT IN ('Pago', 'Estornado') RETURNING serial",
    )
    .bind(serial)
    .first());

/** Registra até onde a baixa de estoque chegou (retomada segura se o aviso for reenviado). */
export const setStockDone = (db: Db, serial: string, n: number) =>
  db.prepare('UPDATE orders SET stock_done = ? WHERE serial = ?').bind(n, serial).run();

/**
 * Efeito do pagamento no cofre, uma vez só: compra → itens marcados entram no cofre; envio → itens separados
 * saem para envio. Tudo num batch junto com vault_done = 1 (ou tudo, ou nada).
 */
export const applyVaultEffects = async (db: Db, serial: string, order: OrderRow, now = Date.now()) => {
  if (order.vault_done || !order.user_id) return;
  const at = day(now);
  const done = db.prepare('UPDATE orders SET vault_done = 1 WHERE serial = ? AND vault_done = 0').bind(serial);
  if (order.kind === 'compra') {
    const items = JSON.parse(order.vault_json) as VaultIntent[];
    const created = new Date(now).toISOString();
    await db.batch([
      ...items.flatMap((it) => [
        db
          .prepare(
            "INSERT INTO vault_items (id, user_id, product_id, name, meta, qty, status, order_serial, created_at) VALUES (?, ?, ?, ?, ?, ?, 'cofre', ?, ?)",
          )
          .bind(crypto.randomUUID(), order.user_id, it.id, it.name, it.meta, it.qty, serial, created),
        db
          .prepare('INSERT INTO vault_history (user_id, at, text) VALUES (?, ?, ?)')
          .bind(order.user_id, at, `guardado no cofre · ${it.name}${it.qty > 1 ? ` (${it.qty} un.)` : ''}`),
      ]),
      done,
    ]);
    return;
  }
  const { results } = await db
    .prepare("SELECT name FROM vault_items WHERE shipment_serial = ? AND status = 'cofre'")
    .bind(serial)
    .all<{ name: string }>();
  await db.batch([
    db.prepare("UPDATE vault_items SET status = 'envio' WHERE shipment_serial = ? AND status = 'cofre'").bind(serial),
    ...results.map((it) =>
      db
        .prepare('INSERT INTO vault_history (user_id, at, text) VALUES (?, ?, ?)')
        .bind(order.user_id, at, `pedido de envio · ${it.name}`),
    ),
    done,
  ]);
};

/**
 * Estorno ou chargeback de pedido pago: o pedido vira Estornado e as cartas dessa compra saem do cofre
 * (não podem ser enviadas de graça depois). Itens já enviados ficam como estão — a loja resolve à parte.
 */
export const markRefunded = async (db: Db, serial: string, now = Date.now()) => {
  const order = await db
    .prepare("UPDATE orders SET status = 'Estornado' WHERE serial = ? AND status = 'Pago' RETURNING user_id, kind")
    .bind(serial)
    .first<{ user_id: string | null; kind: string }>();
  if (!order?.user_id || order.kind !== 'compra') return;
  const { results } = await db
    .prepare("DELETE FROM vault_items WHERE order_serial = ? AND status = 'cofre' RETURNING name")
    .bind(serial)
    .all<{ name: string }>();
  if (results.length)
    await db.batch(
      results.map((it) =>
        db
          .prepare('INSERT INTO vault_history (user_id, at, text) VALUES (?, ?, ?)')
          .bind(order.user_id, day(now), `removido do cofre · pagamento estornado · ${it.name}`),
      ),
    );
};

/** Pedido que não vai ser pago: Cancelado (recusado) ou Falhou (não chegou ao painel). Pago e Estornado ficam. */
export const markOrderStatus = (db: Db, serial: string, status: string) =>
  db
    .prepare("UPDATE orders SET status = ? WHERE serial = ? AND status NOT IN ('Pago', 'Estornado')")
    .bind(status, serial)
    .run();

/** Itens do cliente que impedem apagar a conta: no cofre, em envio ou numa compra para o cofre ainda aberta. */
export const pendingCustody = async (db: Db, userId: string) => {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM vault_items WHERE user_id = ? AND status IN ('cofre', 'envio'))
            + (SELECT COUNT(*) FROM orders WHERE user_id = ? AND kind = 'compra' AND vault_json <> '[]'
                 AND status = 'Aguardando pagamento') AS n`,
    )
    .bind(userId, userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

/** LGPD: tudo o que a conta guarda, para o cliente baixar. */
export const exportAccount = async (db: Db, user: User) => {
  const created = await db
    .prepare('SELECT created_at FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ created_at: string }>();
  return { ...(await getAccount(db, user)), createdAt: created?.created_at ?? null };
};

/** LGPD: apaga a conta. Pedidos ficam (obrigação fiscal), sem o vínculo com a pessoa. */
export const deleteAccount = (db: Db, userId: string) =>
  db.batch([
    db.prepare('DELETE FROM dex WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM vault_history WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM vault_items WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('UPDATE orders SET user_id = NULL WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
