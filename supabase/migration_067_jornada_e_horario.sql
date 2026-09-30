-- ============================================================
-- Migration 067 — Horário do vínculo e aviso de jornada fora do combinado
-- ------------------------------------------------------------
-- Pedido do Gabriel (30/09/2026):
--   · O vínculo pode ter horário definido (ex.: 08:00 às 20:00) ou ficar livre
--     (a pessoa só precisa cumprir as horas por dia).
--   · O sistema avisa quando a pessoa trabalha a menos ou a mais que a jornada,
--     para Fixo e para Consultoria com salário fixo.
--   · O RH marca "Ciente" em cada dia e ele sai do aviso.
-- Não mexe em nenhum dado existente.
-- ============================================================

-- Horário definido (vazio = livre) e intervalo do dia em minutos (almoço).
-- O portal não pede intervalo: a conta das horas desconta o do vínculo.
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS work_start    time,
  ADD COLUMN IF NOT EXISTS work_end      time,
  ADD COLUMN IF NOT EXISTS break_minutes integer;

-- Quando o RH viu o dia fora da jornada
ALTER TABLE nutritionist_visits
  ADD COLUMN IF NOT EXISTS jornada_seen_at timestamptz;

-- Se a pessoa corrigir o horário depois, o dia volta para o aviso
CREATE OR REPLACE FUNCTION jornada_reabre_aviso() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.check_in, NEW.check_out, NEW.break_start, NEW.break_end)
     IS DISTINCT FROM (OLD.check_in, OLD.check_out, OLD.break_start, OLD.break_end) THEN
    NEW.jornada_seen_at := NULL;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_jornada_reabre_aviso ON nutritionist_visits;
CREATE TRIGGER trg_jornada_reabre_aviso
  BEFORE UPDATE ON nutritionist_visits
  FOR EACH ROW EXECUTE FUNCTION jornada_reabre_aviso();

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 4
SELECT count(*) AS deve_dar_4 FROM information_schema.columns
 WHERE (table_name = 'employee_client_links' AND column_name IN ('work_start', 'work_end', 'break_minutes'))
    OR (table_name = 'nutritionist_visits'   AND column_name = 'jornada_seen_at');
