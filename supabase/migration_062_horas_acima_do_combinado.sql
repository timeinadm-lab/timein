-- ============================================================
-- Migration 062 — Visita acima das horas combinadas vai para Pagamentos
-- ------------------------------------------------------------
-- Pedido do Gabriel (29/09/2026):
--   Consultoria por visita, combinado de 2h30:
--   · fez menos (2h)  → recebe proporcional (já era assim)
--   · fez mais (3h)   → recebe o valor INTEIRO da visita (teto, já era assim)
--                       e as horas a mais vão para Pagamentos, onde o RH
--                       decide: paga a hora extra ou não.
--
-- Antes: a pessoa via "aguardando aprovação" no portal, mas nada ficava
-- aguardando e o RH nunca era avisado.
--
-- Como funciona: um gatilho na tabela de visitas calcula, sempre que os
-- horários mudam, quanto passou do combinado e um valor sugerido
-- (valor da unidade ÷ horas combinadas × horas a mais). A visita segue paga
-- normalmente; só o extra fica "pendente" até o RH decidir.
-- Consultoria com salário fixo e Fixo não entram (não são pagos por visita).
-- Não muda o valor de nenhuma visita.
-- ============================================================

ALTER TABLE nutritionist_visits
  ADD COLUMN IF NOT EXISTS excesso_min           integer,
  ADD COLUMN IF NOT EXISTS excesso_sugerido      numeric(10,2),
  ADD COLUMN IF NOT EXISTS excesso_status        text,
  ADD COLUMN IF NOT EXISTS excesso_valor         numeric(10,2),
  ADD COLUMN IF NOT EXISTS excesso_decidido_em   timestamptz,
  ADD COLUMN IF NOT EXISTS excesso_decidido_por  uuid REFERENCES user_profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visits_excesso_status_check') THEN
    ALTER TABLE nutritionist_visits
      ADD CONSTRAINT visits_excesso_status_check CHECK (excesso_status IN ('pendente', 'pago', 'nao_pago'));
  END IF;
END$$;

-- Quanto passou do combinado e o valor sugerido para as horas a mais
CREATE OR REPLACE FUNCTION visita_excesso(
  p_emp uuid, p_client uuid, p_unit uuid, p_date date,
  p_in text, p_out text, p_b1 text, p_b2 text
) RETURNS TABLE (minutos integer, sugerido numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link  employee_client_links%ROWTYPE;
  v_in    time := nullif(btrim(coalesce(p_in, '')), '')::time;
  v_out   time := nullif(btrim(coalesce(p_out, '')), '')::time;
  v_b1    time := nullif(btrim(coalesce(p_b1, '')), '')::time;
  v_b2    time := nullif(btrim(coalesce(p_b2, '')), '')::time;
  v_min   numeric;
  v_exc   numeric;
  v_rate  numeric;
BEGIN
  IF v_in IS NULL OR v_out IS NULL THEN RETURN; END IF;

  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = p_emp AND client_id = p_client
     AND (start_date IS NULL OR p_date >= start_date)
     AND (contract_end_date IS NULL OR p_date <= contract_end_date)
   ORDER BY (is_temporary OR service_type = 'Volante') DESC, start_date DESC NULLS LAST
   LIMIT 1;

  IF v_link.id IS NULL
     OR COALESCE(v_link.coverage_type, v_link.service_type) <> 'Consultoria'
     OR v_link.pay_mode = 'salario_fixo'
     OR COALESCE(v_link.weekly_hours_quota, 0) <= 0 THEN
    RETURN;
  END IF;

  -- Minutos líquidos (virada de meia-noite conta como dia seguinte)
  v_min := EXTRACT(EPOCH FROM (v_out - v_in)) / 60;
  IF v_min < 0 THEN v_min := v_min + 1440; END IF;
  IF v_b1 IS NOT NULL AND v_b2 IS NOT NULL THEN
    v_min := v_min - GREATEST(0, EXTRACT(EPOCH FROM (v_b2 - v_b1)) / 60);
  END IF;

  v_exc := v_min - v_link.weekly_hours_quota * 60;
  IF v_exc <= 0 THEN RETURN; END IF;

  SELECT (elem->>'visit_rate')::numeric INTO v_rate
    FROM jsonb_array_elements(COALESCE(v_link.link_units, '[]'::jsonb)) elem
   WHERE (elem->>'unit_id')::uuid = p_unit
   LIMIT 1;

  minutos := round(v_exc);
  sugerido := CASE WHEN v_rate > 0 THEN round(v_rate / (v_link.weekly_hours_quota * 60) * v_exc, 2) END;
  RETURN NEXT;
END$$;

CREATE OR REPLACE FUNCTION trg_visita_excesso() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  -- Só recalcula quando muda horário/cliente/unidade. Decisão do RH (pago /
  -- não pago) e outras edições não mexem no que já foi decidido.
  IF TG_OP = 'UPDATE'
     AND NEW.check_in::text   IS NOT DISTINCT FROM OLD.check_in::text
     AND NEW.check_out::text  IS NOT DISTINCT FROM OLD.check_out::text
     AND NEW.break_start::text IS NOT DISTINCT FROM OLD.break_start::text
     AND NEW.break_end::text  IS NOT DISTINCT FROM OLD.break_end::text
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND NEW.unit_id   IS NOT DISTINCT FROM OLD.unit_id
     AND NEW.is_unavailable IS NOT DISTINCT FROM OLD.is_unavailable THEN
    RETURN NEW;
  END IF;

  NEW.excesso_min := NULL; NEW.excesso_sugerido := NULL; NEW.excesso_status := NULL;
  NEW.excesso_valor := NULL; NEW.excesso_decidido_em := NULL; NEW.excesso_decidido_por := NULL;
  IF coalesce(NEW.is_unavailable, false) OR coalesce(NEW.is_holiday, false) THEN RETURN NEW; END IF;

  SELECT * INTO r FROM visita_excesso(NEW.employee_id, NEW.client_id, NEW.unit_id, NEW.visit_date,
    NEW.check_in::text, NEW.check_out::text, NEW.break_start::text, NEW.break_end::text);
  IF r.minutos IS NOT NULL THEN
    NEW.excesso_min := r.minutos;
    NEW.excesso_sugerido := r.sugerido;
    NEW.excesso_status := 'pendente';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS visita_excesso ON nutritionist_visits;
CREATE TRIGGER visita_excesso BEFORE INSERT OR UPDATE ON nutritionist_visits
  FOR EACH ROW EXECUTE FUNCTION trg_visita_excesso();

-- Visitas da quinzena ainda não paga (16/09 em diante) entram já com o aviso.
-- A 1ª quinzena de setembro já foi paga no dia 20 e fica como está.
WITH calc AS (
  SELECT v.id, r.minutos, r.sugerido
    FROM nutritionist_visits v
    CROSS JOIN LATERAL visita_excesso(v.employee_id, v.client_id, v.unit_id, v.visit_date,
      v.check_in::text, v.check_out::text, v.break_start::text, v.break_end::text) r
   WHERE v.visit_date >= '2026-09-16'
     AND v.excesso_status IS NULL
     AND NOT coalesce(v.is_unavailable, false) AND NOT coalesce(v.is_holiday, false)
)
UPDATE nutritionist_visits v SET
  excesso_min = c.minutos, excesso_sugerido = c.sugerido, excesso_status = 'pendente'
FROM calc c WHERE c.id = v.id;

NOTIFY pgrst, 'reload schema';

-- Conferência: visitas com horas acima do combinado esperando decisão
SELECT count(*) AS aguardando_decisao, sum(excesso_min) AS minutos_a_mais
  FROM nutritionist_visits WHERE excesso_status = 'pendente';
