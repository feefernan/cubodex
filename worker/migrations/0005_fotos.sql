-- Fotos próprias dos produtos (Fase 2.2): cópias no R2 das imagens que o dono sobe no Notion (os links do Notion
-- expiram em cerca de 1 hora). A lista de um produto só muda quando todas as imagens dela já estão no R2.

CREATE TABLE photos (
  product_id TEXT NOT NULL,
  pos INTEGER NOT NULL,
  key TEXT NOT NULL,
  PRIMARY KEY (product_id, pos)
);
