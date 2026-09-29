-- ============================================================
-- Migration 063 — Supervisão com unidade do cliente
-- ------------------------------------------------------------
-- Pedido do Gabriel (29/09/2026): ao agendar a supervisão, escolher o
-- cliente E a unidade dele. Guarda o id e o nome da unidade (o nome fica
-- mesmo se a unidade for apagada depois).
-- ============================================================

ALTER TABLE supervision_visits
  ADD COLUMN IF NOT EXISTS unit_id   uuid REFERENCES client_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_name text;

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS supervisoes, count(unit_id) AS com_unidade FROM supervision_visits;
