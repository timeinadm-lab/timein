-- ============================================================
-- Migration 066 — Reunião com vários colaboradores e datas repetidas
-- ------------------------------------------------------------
-- Pedido da Maria Fernanda (29/09/2026): numa reunião diária com o cliente
-- só dava para vincular UM colaborador. Agora é uma lista.
-- employee_id continua existindo (= o primeiro da lista) para as telas e
-- registros antigos seguirem funcionando.
--
-- Pedido do Gabriel (29/09/2026): marcar a reunião em várias datas (ex.: toda
-- terça de junho e julho). Cada data vira uma reunião; serie_id liga todas,
-- para dar para apagar a série de uma vez.
-- ============================================================

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS employee_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS serie_id     uuid;

CREATE INDEX IF NOT EXISTS idx_interviews_serie ON interviews (serie_id) WHERE serie_id IS NOT NULL;

-- Quem já tinha um colaborador vinculado entra na lista
UPDATE interviews SET employee_ids = ARRAY[employee_id]
 WHERE employee_id IS NOT NULL AND coalesce(array_length(employee_ids, 1), 0) = 0;

CREATE INDEX IF NOT EXISTS idx_interviews_employee_ids ON interviews USING gin (employee_ids);

NOTIFY pgrst, 'reload schema';

SELECT count(*) FILTER (WHERE array_length(employee_ids, 1) > 0) AS compromissos_com_colaborador FROM interviews;
