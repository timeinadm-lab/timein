-- =====================================================================
-- migration_017_complete_fix.sql
-- Correções completas: colunas faltantes, Realtime e histórico de vínculo
-- Execute APÓS as migrations 013, 014, 015 e 016
-- =====================================================================

-- ── 1. Colunas faltantes em employee_client_links ──────────────────
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS work_schedule_type   TEXT,
  ADD COLUMN IF NOT EXISTS daily_hours          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS days_off             INTEGER[],
  ADD COLUMN IF NOT EXISTS schedule_anchor_date DATE,
  ADD COLUMN IF NOT EXISTS monthly_hours_quota  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS link_units           JSONB,
  ADD COLUMN IF NOT EXISTS contract_end_date    DATE,
  ADD COLUMN IF NOT EXISTS visits_per_week      NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS pay_extra_visits     BOOLEAN;

-- ── 2. Colunas faltantes em nutritionist_visits (IF NOT EXISTS) ────
-- (essas colunas provavelmente já existem se o portal estava funcionando)
ALTER TABLE nutritionist_visits
  ADD COLUMN IF NOT EXISTS unit_id         UUID,
  ADD COLUMN IF NOT EXISTS unit_name       TEXT,
  ADD COLUMN IF NOT EXISTS visit_rate      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS extra_approval  TEXT,
  ADD COLUMN IF NOT EXISTS proposed_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS extra_amount    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS is_extra        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_swap         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS swapped_from    DATE,
  ADD COLUMN IF NOT EXISTS atestado_url    TEXT,
  ADD COLUMN IF NOT EXISTS report_url      TEXT;

-- ── 3. Habilitar Realtime ──────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE employee_questions;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- ── 4. Tabela de histórico automático de vínculos ──────────────────
CREATE TABLE IF NOT EXISTS link_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  link_id     UUID NOT NULL REFERENCES employee_client_links(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  description TEXT NOT NULL,
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE link_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_link_history" ON link_history
  FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_link_history_employee ON link_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_link_history_link     ON link_history(link_id);

-- ── 5. Função trigger para auto-log de alterações de vínculo ───────
CREATE OR REPLACE FUNCTION fn_log_link_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  client_name TEXT;
BEGIN
  SELECT name INTO client_name FROM clients WHERE id = COALESCE(NEW.client_id, OLD.client_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO link_history (link_id, employee_id, action, description)
    VALUES (
      NEW.id, NEW.employee_id, 'criado',
      format('Vínculo criado: %s — %s', COALESCE(NEW.service_type, '?'), COALESCE(client_name, '?'))
    );

  ELSIF TG_OP = 'UPDATE' THEN
    -- Se encerrou (definiu contract_end_date pela primeira vez)
    IF NEW.contract_end_date IS NOT NULL
       AND (OLD.contract_end_date IS NULL OR OLD.contract_end_date <> NEW.contract_end_date) THEN
      INSERT INTO link_history (link_id, employee_id, action, description)
      VALUES (
        NEW.id, NEW.employee_id, 'encerrado',
        format('Prazo de encerramento definido para %s — %s', to_char(NEW.contract_end_date, 'DD/MM/YYYY'), COALESCE(client_name, '?'))
      );
    ELSE
      INSERT INTO link_history (link_id, employee_id, action, description)
      VALUES (
        NEW.id, NEW.employee_id, 'editado',
        format('Vínculo atualizado: %s — %s', COALESCE(NEW.service_type, '?'), COALESCE(client_name, '?'))
      );
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_link_history ON employee_client_links;
CREATE TRIGGER trg_log_link_history
  AFTER INSERT OR UPDATE ON employee_client_links
  FOR EACH ROW EXECUTE FUNCTION fn_log_link_history();

-- ── 6. Recarregar schema ───────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
