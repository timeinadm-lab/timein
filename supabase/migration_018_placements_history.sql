-- ============================================================
-- MIGRATION 018 — Histórico de passagens (vagas + coberturas)
-- ============================================================
-- Guarda toda passagem de colaborador em vaga ou cobertura,
-- mesmo depois de deletado o vínculo ou o colaborador.
-- Assim conseguimos mostrar:
--  • Na vaga → todos que já passaram por ela
--  • No colaborador → todas as vagas/coberturas por onde passou

CREATE TABLE IF NOT EXISTS placements_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  employee_name   TEXT NOT NULL,          -- snapshot: sobrevive à exclusão
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name     TEXT NOT NULL,          -- snapshot
  vacancy_id      UUID REFERENCES vacancies(id) ON DELETE SET NULL,
  vacancy_title   TEXT,                   -- snapshot (NULL se foi cobertura pura)
  service_type    TEXT,                   -- 'Fixo' | 'Consultoria' | 'Volante'
  monthly_amount  NUMERIC,                -- salário / diária vigente na saída
  start_date      DATE,                   -- entrada
  end_date        DATE NOT NULL,          -- saída (dia do desligamento)
  dismissal_reason TEXT,                  -- motivo (opcional)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE placements_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_placements_history" ON placements_history
  FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_placements_employee ON placements_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_placements_vacancy  ON placements_history(vacancy_id);
CREATE INDEX IF NOT EXISTS idx_placements_client   ON placements_history(client_id);

-- ── Trigger: sempre que um vínculo é apagado, carimba a passagem ──
CREATE OR REPLACE FUNCTION fn_snapshot_placement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp_name  TEXT;
  cli_name  TEXT;
  vac_title TEXT;
BEGIN
  SELECT full_name INTO emp_name FROM employees WHERE id = OLD.employee_id;
  SELECT name       INTO cli_name FROM clients   WHERE id = OLD.client_id;
  IF OLD.vacancy_id IS NOT NULL THEN
    SELECT title INTO vac_title FROM vacancies WHERE id = OLD.vacancy_id;
  END IF;

  INSERT INTO placements_history (
    employee_id, employee_name, client_id, client_name,
    vacancy_id, vacancy_title, service_type, monthly_amount,
    start_date, end_date
  ) VALUES (
    OLD.employee_id, COALESCE(emp_name, '(colaborador removido)'),
    OLD.client_id,   COALESCE(cli_name, '(cliente removido)'),
    OLD.vacancy_id,  vac_title,
    OLD.service_type, OLD.monthly_amount,
    OLD.start_date, CURRENT_DATE
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_placement ON employee_client_links;
CREATE TRIGGER trg_snapshot_placement
  BEFORE DELETE ON employee_client_links
  FOR EACH ROW EXECUTE FUNCTION fn_snapshot_placement();

NOTIFY pgrst, 'reload schema';
