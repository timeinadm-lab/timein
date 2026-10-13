-- ============================================================
-- 091 — Fixo por HORAS NA SEMANA (pedido de 13/10/2026)
-- "O contrato exige 30 horas semanais. Ela pode fazer 10 na segunda,
--  10 na quarta, 10 na sexta, ou picar — mas tem que fechar as 30."
--
-- Escala nova no vínculo Fixo: work_schedule_type = 'horas' + horas_semana.
-- Sem dias de folga e sem horas por dia: o sistema soma seg→dom no ponto
-- do portal e mostra na Jornada quanto ela fez de cada semana.
-- Coluna nova (e não weekly_hours_quota) porque aquela, na consultoria,
-- é "horas por visita" e entra no valor da visita.
-- Rodar uma vez no SQL Editor do Supabase.
-- ============================================================

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS horas_semana numeric;

DO $$ BEGIN
  ALTER TABLE employee_client_links
    ADD CONSTRAINT horas_semana_valida CHECK (horas_semana IS NULL OR (horas_semana > 0 AND horas_semana <= 168));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

-- Conferir: tem que dar 1
SELECT count(*) AS coluna FROM information_schema.columns
WHERE table_name = 'employee_client_links' AND column_name = 'horas_semana';
