-- =====================================================================
-- migration_012_consultoria_frequency.sql
-- Frequência de visita (Semanal/Quinzenal/Mensal) + agenda admin-fixed
-- Execute no Supabase SQL Editor
-- =====================================================================

-- 1. Frequência na tabela de vínculos
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS visit_frequency TEXT DEFAULT 'Semanal'
    CHECK (visit_frequency IN ('Semanal', 'Quinzenal', 'Mensal'));

-- 2. Frequência na tabela de vagas
ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS visit_frequency TEXT DEFAULT 'Semanal'
    CHECK (visit_frequency IN ('Semanal', 'Quinzenal', 'Mensal'));

-- 3. Agenda: campo para horas esperadas e flag de item fixado pelo admin
ALTER TABLE nutritionist_agenda
  ADD COLUMN IF NOT EXISTS hours_expected  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Portal: remarcar — bloquear itens fixados pelo admin
CREATE OR REPLACE FUNCTION portal_reschedule_agenda(p_token text, p_id uuid, p_new_date date, p_original date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  IF EXISTS (SELECT 1 FROM nutritionist_agenda WHERE id = p_id AND created_by_admin = TRUE) THEN
    RAISE EXCEPTION 'Este agendamento foi fixado pelo RH e não pode ser alterado.';
  END IF;
  UPDATE nutritionist_agenda
     SET planned_date = p_new_date,
         original_date = coalesce(original_date, p_original),
         rescheduled_at = now()
   WHERE id = p_id AND employee_id = uid;
END$$;

-- 5. Portal: excluir — bloquear itens fixados pelo admin
CREATE OR REPLACE FUNCTION portal_delete_agenda(p_token text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  IF EXISTS (SELECT 1 FROM nutritionist_agenda WHERE id = p_id AND created_by_admin = TRUE) THEN
    RAISE EXCEPTION 'Este agendamento foi fixado pelo RH e não pode ser excluído.';
  END IF;
  DELETE FROM nutritionist_agenda WHERE id = p_id AND employee_id = uid;
END$$;

NOTIFY pgrst, 'reload schema';
