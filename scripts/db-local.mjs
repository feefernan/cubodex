// Aplica worker/migrations no D1 local do `npm run dev` (estado do plugin do Cloudflare em .cloudflare/state).
// Usa a mesma tabela de controle do `cf d1 migrations apply` (d1_migrations): rodar de novo não repete nada.
// Uso: rode `npm run dev` uma vez (cria o banco local), pare, e então `npm run db:local`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = '.cloudflare/state/v3/d1/miniflare-D1DatabaseObject';
const files = (() => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  } catch {
    return [];
  }
})();
if (!files.length) {
  console.error('Nenhum D1 local ainda. Rode `npm run dev` e abra o site uma vez.');
  process.exit(1);
}
const migrations = readdirSync('worker/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort();
for (const file of files) {
  const db = new DatabaseSync(join(dir, file));
  db.exec(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  const done = new Set(
    db
      .prepare('SELECT name FROM d1_migrations')
      .all()
      .map((r) => r.name),
  );
  for (const name of migrations.filter((m) => !done.has(m))) {
    db.exec(readFileSync(join('worker/migrations', name), 'utf-8'));
    db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(name);
    console.log(`aplicada ${name} em ${file}`);
  }
  db.close();
}
