-- ============================================================
-- Migration 059 — Supervisão vira uma agenda interna da equipe
-- ------------------------------------------------------------
-- Pedido do Gabriel (28/09/2026): qualquer pessoa da equipe (chefe,
-- recrutador…) pode fazer supervisão. A equipe monta a agenda: cliente, dia e
-- responsável. No dia, o responsável dá check-in. Se não aconteceu, fica
-- registrado como "não realizada" e dá para remarcar, trocar o responsável ou
-- excluir o agendamento.
--
-- Reaproveita supervision_visits (o histórico que já existe continua lá, como
-- "realizada"). Só ganha status e o rastro do check-in / remarcação.
-- ============================================================

ALTER TABLE supervision_visits
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'realizada',
  ADD COLUMN IF NOT EXISTS checked_in_at        timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by        uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_nao_realizada text,
  ADD COLUMN IF NOT EXISTS remarcada_de         uuid REFERENCES supervision_visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by           uuid REFERENCES user_profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supervision_status_check') THEN
    ALTER TABLE supervision_visits
      ADD CONSTRAINT supervision_status_check CHECK (status IN ('agendada', 'realizada', 'nao_realizada'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_supervision_visits_date ON supervision_visits (visit_date);
CREATE INDEX IF NOT EXISTS idx_supervision_visits_status ON supervision_visits (status);

NOTIFY pgrst, 'reload schema';

-- Conferência: o histórico que já existia fica como "realizada"
SELECT status, count(*) AS supervisoes FROM supervision_visits GROUP BY status;
