-- ============================================================
-- Migration 101 — Auditoria GR: valor pago ao auditor (terceirizado)
-- ------------------------------------------------------------
-- Pedido do Gabriel (20/10/2026): a auditoria é feita por um nutricionista
-- terceirizado; a ficha guarda quanto ele recebe, o PIX, se já foi pago e
-- quando. Uso INTERNO: não vai no relatório do cliente (só no interno, com a
-- sobra = total do orçamento − valor do auditor).
-- Precisa da 087 (e da 100 para o resto do financeiro). Não apaga nada.
-- Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS valor_auditor     numeric(10,2);
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS auditor_pix       text;
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS auditor_pagamento text NOT NULL DEFAULT 'A pagar';
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS auditor_pago_em   date;

ALTER TABLE auditorias_fornecedores DROP CONSTRAINT IF EXISTS aud_forn_auditor_pagamento_ok;
ALTER TABLE auditorias_fornecedores ADD CONSTRAINT aud_forn_auditor_pagamento_ok
  CHECK (auditor_pagamento IN ('A pagar', 'Pago'));
ALTER TABLE auditorias_fornecedores DROP CONSTRAINT IF EXISTS aud_forn_valor_auditor_ok;
ALTER TABLE auditorias_fornecedores ADD CONSTRAINT aud_forn_valor_auditor_ok
  CHECK (valor_auditor IS NULL OR valor_auditor >= 0);

NOTIFY pgrst, 'reload schema';

-- Conferência: as 4 colunas do auditor (esperado: 4)
SELECT count(*) AS colunas_auditor FROM information_schema.columns
 WHERE table_name = 'auditorias_fornecedores'
   AND column_name IN ('valor_auditor', 'auditor_pix', 'auditor_pagamento', 'auditor_pago_em');
