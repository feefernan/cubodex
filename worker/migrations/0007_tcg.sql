-- Enciclopédia TCG (Fase 3): todos os sets e cartas do TCGdex, sincronizados por uma Action semanal
-- (scripts/tcg-sync.ts). `h` é o hash do conteúdo: a Action só grava o que mudou.

CREATE TABLE tcg_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_pt TEXT,                    -- nome em português, quando o set existe em PT
  serie_id TEXT NOT NULL DEFAULT '',
  serie TEXT NOT NULL DEFAULT '',
  released TEXT,                   -- AAAA-MM-DD
  total INTEGER NOT NULL DEFAULT 0,
  official INTEGER NOT NULL DEFAULT 0,
  logo TEXT,                       -- caminho no CDN do TCGdex, sem o endereço base
  symbol TEXT,
  h TEXT NOT NULL DEFAULT ''
);
CREATE INDEX tcg_sets_serie ON tcg_sets(serie_id, released);

CREATE TABLE tcg_cards (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  num INTEGER,                     -- número para ordenar (nulo em "TG01", "H1"…)
  name TEXT NOT NULL,
  name_pt TEXT,
  rarity TEXT,
  category TEXT,
  types TEXT,                      -- tipos separados por vírgula
  variants TEXT,                   -- normal,reverse,holo,firstEdition (os que existem)
  image TEXT,                      -- caminho no CDN, sem idioma nem qualidade (ex.: sv/sv03.5/006)
  h TEXT NOT NULL DEFAULT ''
);
CREATE INDEX tcg_cards_set ON tcg_cards(set_id, num, local_id);
CREATE INDEX tcg_cards_name ON tcg_cards(name);
