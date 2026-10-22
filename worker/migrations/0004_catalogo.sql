-- Catálogo no D1 (Fase 2): espelho dos Produtos do Notion, sincronizado por cron, e dono do estoque.
-- A baixa de estoque é um UPDATE atômico aqui (qty = qty - ? WHERE qty >= ?); o Notion recebe o valor depois.

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  price REAL,                              -- NULL = o preço do código vale
  qty INTEGER,                             -- NULL = sem controle de estoque (peça sob demanda)
  active INTEGER NOT NULL DEFAULT 1,
  presale INTEGER NOT NULL DEFAULT 0,
  page_id TEXT NOT NULL DEFAULT '',        -- página do Notion, para gravar o estoque de volta
  dirty INTEGER NOT NULL DEFAULT 0,        -- 1 = houve baixa que o Notion ainda não recebeu
  synced_at TEXT NOT NULL DEFAULT ''
);
