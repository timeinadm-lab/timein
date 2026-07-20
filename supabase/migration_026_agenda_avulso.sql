-- =====================================================================
-- migration_026_agenda_avulso.sql
-- Consultoria "Avulso" + permissão de agenda por vínculo + hora na agenda
-- Execute no Supabase SQL Editor
-- =====================================================================

-- 1. Frequência ganha 'Avulso' (sem cadência fixa; dias vêm da agenda montada)
ALTER TABLE employee_client_links DROP CONSTRAINT IF EXISTS employee_client_links_visit_frequency_check;
ALTER TABLE employee_client_links ADD CONSTRAINT employee_client_links_visit_frequency_check
  CHECK (visit_frequency IN ('Semanal', 'Quinzenal', 'Mensal', 'Avulso'));

ALTER TABLE vacancies DROP CONSTRAINT IF EXISTS vacancies_visit_frequency_check;
ALTER TABLE vacancies ADD CONSTRAINT vacancies_visit_frequency_check
  CHECK (visit_frequency IN ('Semanal', 'Quinzenal', 'Mensal', 'Avulso'));

-- 2. Quem monta a agenda daquele vínculo/contrato:
--    'colaborador' = a pessoa monta no portal | 'gestor' = o RH monta pra ela
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS agenda_mode TEXT NOT NULL DEFAULT 'colaborador'
    CHECK (agenda_mode IN ('colaborador', 'gestor'));

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS agenda_mode TEXT NOT NULL DEFAULT 'colaborador'
    CHECK (agenda_mode IN ('colaborador', 'gestor'));

-- 3. Hora opcional nos dias da agenda
ALTER TABLE nutritionist_agenda
  ADD COLUMN IF NOT EXISTS planned_time TIME;

-- 4. Portal: colaborador só adiciona dia se o vínculo daquele cliente
--    permitir (agenda_mode = 'colaborador'). Também passa a gravar a hora.
CREATE OR REPLACE FUNCTION portal_save_agenda(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  v_client uuid := nullif(p_payload->>'client_id','')::uuid;
  v_id uuid;
BEGIN
  PERFORM portal_assert_link(uid, v_client);
  IF EXISTS (
    SELECT 1 FROM employee_client_links
    WHERE employee_id = uid AND client_id = v_client AND agenda_mode = 'gestor'
  ) THEN
    RAISE EXCEPTION 'A agenda deste cliente é montada pelo RH — você não pode adicionar dias aqui.';
  END IF;
  INSERT INTO nutritionist_agenda (employee_id, client_id, unit_id, planned_date, planned_time, notes)
  VALUES (uid, v_client, nullif(p_payload->>'unit_id','')::uuid,
          (p_payload->>'planned_date')::date,
          nullif(p_payload->>'planned_time','')::time,
          nullif(p_payload->>'notes',''))
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

NOTIFY pgrst, 'reload schema';
