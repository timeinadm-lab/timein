-- Pagamentos ligados ao vínculo/cliente (não só ao colaborador)
-- Corrige: colaborador com 2 clientes tinha os lançamentos misturados
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS link_id uuid;

CREATE INDEX IF NOT EXISTS idx_payments_link ON payments(link_id);
CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);
