-- Histórico das trocas registradas na coleção interna (#100): o que saiu do estoque da loja e o que entrou na coleção.
-- `gave` e `got` são fotos em JSON (o produto pode mudar ou sumir do Notion depois); sem chave estrangeira.

CREATE TABLE col_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  gave TEXT NOT NULL,
  got TEXT NOT NULL
);
