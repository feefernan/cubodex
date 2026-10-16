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

const LOGIN_TTL = 15 * 60_000;
export const SESSION_TTL = 30 * 24 * 60 * 60_000;

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const day = (now: number) =>
  new Date(now).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Cria um token de login de uso único para o e-mail; devolve o token (vai só no link do e-mail). */
export const createLoginToken = async (db: Db, email: string, now = Date.now()) => {
  const token = randomToken();
  await db
    .prepare('INSERT INTO login_tokens (hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), email, now + LOGIN_TTL)
    .run();
  return token;
};

/**
 * Troca o token do link por uma sessão. O UPDATE … RETURNING marca o token como usado no mesmo passo:
 * dois cliques no link (ou um verificador de e-mail) não geram duas sessões.
 */
export const redeemLoginToken = async (db: Db, token: string, now = Date.now()) => {
  const row = await db
    .prepare('UPDATE login_tokens SET used = 1 WHERE hash = ? AND used = 0 AND expires_at > ? RETURNING email')
    .bind(await sha256(token), now)
    .first<{ email: string }>();
  if (!row) return null;
  await db
    .prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(crypto.randomUUID(), row.email, row.email.split('@')[0], new Date(now).toISOString())
    .run();
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(row.email).first<{ id: string }>();
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

export const userVault = (db: Db, userId: string, ids: string[]) =>
  ids.length
    ? db
        .prepare(
          `SELECT id, product_id, name, meta, qty, status, created_at FROM vault_items WHERE user_id = ? AND status = 'cofre' AND id IN (${ids.map(() => '?').join(',')})`,
        )
        .bind(userId, ...ids)
        .all<VaultRow>()
        .then((r) => r.results)
    : Promise.resolve([]);

export interface OrderMirror {
  serial: string;
  userId: string | null;
  kind: 'compra' | 'envio';
  status: string;
  total: number;
  summary: string;
  /** compra: itens a guardar; envio: ids dos itens do cofre. */
  vault: VaultIntent[] | string[];
}

export const recordOrder = (db: Db, o: OrderMirror, now = Date.now()) =>
  db
    .prepare(
      'INSERT INTO orders (serial, user_id, kind, status, total, summary, vault_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      o.serial,
      o.userId,
      o.kind,
      o.status,
      o.total,
      o.summary,
      JSON.stringify(o.vault),
      new Date(now).toISOString(),
    )
    .run();

/**
 * Pagamento confirmado: compra → itens marcados entram no cofre; envio → itens do cofre saem para envio.
 * Idempotente: o UPDATE só muda pedido que ainda não estava Pago, e só então mexe no cofre.
 */
export const markOrderPaid = async (db: Db, serial: string, now = Date.now()) => {
  const order = await db
    .prepare(
      "UPDATE orders SET status = 'Pago' WHERE serial = ? AND status <> 'Pago' RETURNING user_id, kind, vault_json",
    )
    .bind(serial)
    .first<{ user_id: string | null; kind: 'compra' | 'envio'; vault_json: string }>();
  if (!order?.user_id) return;
  const at = day(now);
  const created = new Date(now).toISOString();
  if (order.kind === 'compra') {
    const items = JSON.parse(order.vault_json) as VaultIntent[];
    if (!items.length) return;
    await db.batch(
      items.flatMap((it) => [
        db
          .prepare(
            "INSERT INTO vault_items (id, user_id, product_id, name, meta, qty, status, order_serial, created_at) VALUES (?, ?, ?, ?, ?, ?, 'cofre', ?, ?)",
          )
          .bind(crypto.randomUUID(), order.user_id, it.id, it.name, it.meta, it.qty, serial, created),
        db
          .prepare('INSERT INTO vault_history (user_id, at, text) VALUES (?, ?, ?)')
          .bind(order.user_id, at, `guardado no cofre · ${it.name}${it.qty > 1 ? ` (${it.qty} un.)` : ''}`),
      ]),
    );
    return;
  }
  const ids = JSON.parse(order.vault_json) as string[];
  const items = await userVault(db, order.user_id, ids);
  await db.batch(
    items.flatMap((it) => [
      db.prepare("UPDATE vault_items SET status = 'envio', shipment_serial = ? WHERE id = ?").bind(serial, it.id),
      db
        .prepare('INSERT INTO vault_history (user_id, at, text) VALUES (?, ?, ?)')
        .bind(order.user_id, at, `pedido de envio · ${it.name}`),
    ]),
  );
};

export const markOrderStatus = (db: Db, serial: string, status: string) =>
  db.prepare("UPDATE orders SET status = ? WHERE serial = ? AND status <> 'Pago'").bind(status, serial).run();

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
