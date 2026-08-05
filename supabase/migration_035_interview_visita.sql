-- ============================================================
-- Migration 035 — Visita na Agenda (cliente + mês de referência)
-- ------------------------------------------------------------
-- Uma "Visita" na Agenda funciona como visita de verdade: vincula
-- um cliente e tem um dia. Se ficar SEM data, guarda o mês de
-- referência (competência) pra saber até quando ela precisa ser
-- agendada. Nunca entra em pagamento (interviews não mexe em folha).
-- ============================================================

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS target_month DATE;

NOTIFY pgrst, 'reload schema';
