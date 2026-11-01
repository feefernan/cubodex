-- Destaques da página inicial escolhidos no Notion (coluna "Destaque", caixa de seleção).

ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
