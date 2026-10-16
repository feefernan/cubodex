-- Contas do Cubodex (#29): login por link mágico, Dex, cofre e pedidos.
-- Tokens de login e de sessão são guardados só como hash SHA-256; o valor vive no e-mail ou no cookie.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE login_tokens (
  hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE dex (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mini_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('have', 'want')),
  PRIMARY KEY (user_id, mini_id)
);

CREATE TABLE vault_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  meta TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  status TEXT NOT NULL CHECK (status IN ('cofre', 'envio', 'enviado')),
  order_serial TEXT NOT NULL,
  shipment_serial TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX vault_user ON vault_items(user_id);

CREATE TABLE vault_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX history_user ON vault_history(user_id);

-- Espelho dos pedidos para a conta: compras e envios do cofre. O Notion continua sendo o painel da loja.
CREATE TABLE orders (
  serial TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('compra', 'envio')),
  status TEXT NOT NULL,
  total REAL NOT NULL,
  summary TEXT NOT NULL,
  -- compra: itens a guardar no cofre ([{id, qty, name, meta}]); envio: ids dos itens do cofre
  vault_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX orders_user ON orders(user_id);
