-- Pagamento idempotente (#39): o pedido guarda o que baixar do estoque e marca o progresso dos efeitos,
-- para que um aviso repetido do Mercado Pago termine o que faltou sem repetir o que já foi feito.
ALTER TABLE orders ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]';
-- Quantas linhas de items_json já tiveram o estoque baixado.
ALTER TABLE orders ADD COLUMN stock_done INTEGER NOT NULL DEFAULT 0;
-- 1 quando o cofre já recebeu (compra) ou já liberou para envio (envio) os itens do pedido.
ALTER TABLE orders ADD COLUMN vault_done INTEGER NOT NULL DEFAULT 0;
CREATE INDEX vault_shipment ON vault_items(shipment_serial);
