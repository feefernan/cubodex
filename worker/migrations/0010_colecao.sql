-- Coleção interna (#80): uma coleção compartilhada da loja, só para os e-mails autorizados (OWNER_EMAILS).
-- Cartas, fotos e dados dos sets vêm de tcg_cards/tcg_sets; aqui fica só o que acompanhamos e o que temos.
-- Sem chave estrangeira para tcg_*: a enciclopédia é recarregada toda semana e a posse não pode sumir junto.

CREATE TABLE col_sets (
  set_id TEXT PRIMARY KEY,
  added_at TEXT NOT NULL
);

CREATE TABLE col_items (
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (card_id, variant)
) WITHOUT ROWID;
