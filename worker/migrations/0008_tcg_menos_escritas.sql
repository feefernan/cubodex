-- A carga inicial grava ~24 mil cartas. No D1, cada índice conta como mais uma linha escrita por inserção, e o plano
-- gratuito tem 100 mil escritas por dia. Com tabela comum e três índices seriam ~95 mil; sem rowid e sem o índice de
-- nome (busca por trecho não usa índice) ficam ~48 mil. As tabelas ainda estão vazias, então recriar não perde nada.

DROP TABLE tcg_cards;
CREATE TABLE tcg_cards (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  num INTEGER,
  name TEXT NOT NULL,
  name_pt TEXT,
  rarity TEXT,
  category TEXT,
  types TEXT,
  variants TEXT,
  image TEXT,
  h TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
CREATE INDEX tcg_cards_set ON tcg_cards(set_id, num, local_id);
