/** D1 de mentira para testes: SQLite do Node com a migração real e a mesma forma de API (prepare/bind/first/all/run/batch). */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, Stmt } from '../../worker/src/accounts';

export const testDb = () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  // Todas as migrações, em ordem, como o deploy aplica.
  const dir = resolve(__dirname, '../../worker/migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(resolve(dir, file), 'utf-8'));
  type Exec = Stmt & { exec(): unknown };
  const stmt = (sql: string, values: SQLInputValue[] = []): Exec => ({
    bind: (...v: unknown[]) => stmt(sql, v as SQLInputValue[]),
    first: async <T>() => (sqlite.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[] }),
    run: async () => sqlite.prepare(sql).run(...values),
    exec: () => sqlite.prepare(sql).run(...values),
  });
  const db: Db = {
    prepare: (sql) => stmt(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const out = (statements as Exec[]).map((s) => s.exec());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, sqlite };
};
