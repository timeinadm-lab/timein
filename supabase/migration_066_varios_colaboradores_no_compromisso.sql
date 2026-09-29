-- ============================================================
-- Migration 066 — Reunião/compromisso com vários colaboradores
-- ------------------------------------------------------------
-- Pedido da Maria Fernanda (29/09/2026): numa reunião diária com o cliente
-- só dava para vincular UM colaborador. Agora é uma lista.
-- employee_id continua existindo (= o primeiro da lista) para as telas e
-- registros antigos seguirem funcionando.
-- ============================================================

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS employee_ids uuid[] NOT NULL DEFAULT '{}';

-- Quem já tinha um colaborador vinculado entra na lista
UPDATE interviews SET employee_ids = ARRAY[employee_id]
 WHERE employee_id IS NOT NULL AND coalesce(array_length(employee_ids, 1), 0) = 0;

CREATE INDEX IF NOT EXISTS idx_interviews_employee_ids ON interviews USING gin (employee_ids);

NOTIFY pgrst, 'reload schema';

SELECT count(*) FILTER (WHERE array_length(employee_ids, 1) > 0) AS compromissos_com_colaborador FROM interviews;
