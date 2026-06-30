-- =====================================================================
-- migration_011_links_complete.sql
-- Vínculos completos: start_date, vacancy_id, constraint Inativo, triggers
-- Execute no Supabase SQL Editor
-- =====================================================================

-- =====================================================================
-- 0. Adiciona 'Inativo' à constraint de status dos colaboradores
--    (sem isso os triggers abaixo falham com check constraint violation)
-- =====================================================================
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_status_check
  CHECK (status IN ('Ativo', 'Ocioso', 'Desligado', 'Inativo'));

-- =====================================================================
-- 1. Garante as colunas necessárias em employee_client_links
-- =====================================================================
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS start_date  date,
  ADD COLUMN IF NOT EXISTS vacancy_id  uuid REFERENCES vacancies(id) ON DELETE SET NULL;

-- =====================================================================
-- 2. Backfill: liga vínculos existentes à vaga correspondente
--    via vacancy_interests que já guarda employee_id + vacancy_id
-- =====================================================================
UPDATE employee_client_links ecl
SET vacancy_id = vi.vacancy_id
FROM vacancy_interests vi
WHERE vi.employee_id  = ecl.employee_id
  AND ecl.vacancy_id IS NULL
  AND vi.status       = 'Contratado';

-- =====================================================================
-- 3. Backfill: start_date a partir do hired_at (melhor data disponível)
-- =====================================================================
UPDATE employee_client_links ecl
SET start_date = vi.hired_at::date
FROM vacancy_interests vi
WHERE vi.employee_id  = ecl.employee_id
  AND ecl.start_date IS NULL
  AND vi.hired_at    IS NOT NULL
  AND vi.status       = 'Contratado';

-- =====================================================================
-- 4. Trigger: ao EXCLUIR o último vínculo de um colaborador → Inativo
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_auto_inativo_sem_vinculos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employee_client_links WHERE employee_id = OLD.employee_id
  ) THEN
    UPDATE employees SET status = 'Inativo' WHERE id = OLD.employee_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_inativo_sem_vinculos ON employee_client_links;
CREATE TRIGGER trg_inativo_sem_vinculos
  AFTER DELETE ON employee_client_links
  FOR EACH ROW EXECUTE FUNCTION fn_auto_inativo_sem_vinculos();

-- =====================================================================
-- 5. Trigger: ao CRIAR um vínculo → garante colaborador Ativo
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_auto_ativo_com_vinculo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE employees SET status = 'Ativo'
  WHERE id = NEW.employee_id AND status != 'Ativo';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ativo_com_vinculo ON employee_client_links;
CREATE TRIGGER trg_ativo_com_vinculo
  AFTER INSERT ON employee_client_links
  FOR EACH ROW EXECUTE FUNCTION fn_auto_ativo_com_vinculo();

-- =====================================================================
-- 6. Aplica Inativo agora a colaboradores sem nenhum vínculo ativo
-- =====================================================================
UPDATE employees
SET status = 'Inativo'
WHERE status = 'Ativo'
  AND NOT EXISTS (
    SELECT 1 FROM employee_client_links WHERE employee_id = employees.id
  );

-- =====================================================================
-- 7. Recarrega cache do PostgREST
-- =====================================================================
NOTIFY pgrst, 'reload schema';
