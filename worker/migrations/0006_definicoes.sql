-- Catálogo vindo só do Notion (Fase 2.3): a descrição de miniaturas, peças, acessórios e do pacote (JSON validado
-- no domínio: `parseDef`). Cartas ainda vêm do código e ficam com def nulo.

ALTER TABLE products ADD COLUMN def TEXT;
