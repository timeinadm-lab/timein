-- ============================================================
-- Migration 065 — Falta e folga na consultoria nunca geram valor
-- ------------------------------------------------------------
-- Pedido do Gabriel (29/09/2026): no portal, Trabalhei / Folga / Faltei
-- passam a valer também para Consultoria (antes só Fixo).
--
-- Trava no banco: registro sem horário, de falta ou de folga fica sem
-- valor, mesmo que o celular mande outra coisa. Sem esta trava, uma falta
-- de consultoria sairia com a visita inteira (a conta proporcional sem
-- horário dava 100%).
-- ============================================================

CREATE OR REPLACE FUNCTION portal_calc_visit_rate(
  p_uid uuid, p_client uuid, p_unit uuid, p_date date,
  p_in time, p_out time, p_b1 time, p_b2 time
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link       employee_client_links%ROWTYPE;
  v_unit_rate  numeric;
  v_quota      numeric;
  v_horas      numeric;
  v_fator      numeric;
BEGIN
  -- Sem horário (falta, folga) não existe visita a pagar. Antes: sem horário a
  -- conta proporcional virava LEAST(1, NULL) = 1 e pagava a visita inteira.
  IF p_in IS NULL OR p_out IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = p_uid AND client_id = p_client
     AND (start_date IS NULL OR p_date >= start_date)
     AND (contract_end_date IS NULL OR p_date <= contract_end_date)
   ORDER BY (is_temporary OR service_type = 'Volante') DESC, start_date DESC NULLS LAST
   LIMIT 1;

  IF v_link.id IS NULL THEN
    SELECT * INTO v_link FROM employee_client_links
     WHERE employee_id = p_uid AND client_id = p_client
     ORDER BY (is_temporary OR service_type = 'Volante') ASC, start_date DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_link.id IS NULL THEN RETURN NULL; END IF;

  -- Fixo (mensal/diária) e consultoria com salário fixo: a folha paga pelo salário
  IF v_link.pay_mode = 'salario_fixo' THEN RETURN NULL; END IF;
  IF COALESCE(v_link.coverage_type, v_link.service_type) = 'Fixo'
     AND v_link.service_type <> 'Consultoria' THEN
    RETURN NULL;
  END IF;

  -- Valor combinado no vínculo; sem ele, o valor da unidade no cadastro do cliente
  v_unit_rate := valor_da_unidade(v_link, p_unit);
  IF v_unit_rate IS NULL OR v_unit_rate <= 0 THEN RETURN NULL; END IF;

  v_quota := v_link.weekly_hours_quota;
  IF v_quota IS NULL OR v_quota <= 0 THEN RETURN ROUND(v_unit_rate, 2); END IF;

  v_horas := portal_horas_liquidas(p_in, p_out, p_b1, p_b2);
  IF v_horas <= 0 THEN RETURN NULL; END IF;

  v_fator := LEAST(1, v_horas / v_quota);
  RETURN ROUND(v_unit_rate * v_fator, 2);
END$$;

CREATE OR REPLACE FUNCTION trg_visita_sem_valor_em_falta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(NEW.is_unavailable, false) OR coalesce(NEW.is_holiday, false)
     OR NEW.check_in IS NULL OR NEW.check_out IS NULL THEN
    NEW.visit_rate := NULL;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS visita_sem_valor_em_falta ON nutritionist_visits;
CREATE TRIGGER visita_sem_valor_em_falta BEFORE INSERT OR UPDATE ON nutritionist_visits
  FOR EACH ROW EXECUTE FUNCTION trg_visita_sem_valor_em_falta();

NOTIFY pgrst, 'reload schema';

-- Conferência: falta/folga com valor (deve dar 0)
SELECT count(*) AS faltas_ou_folgas_com_valor FROM nutritionist_visits
 WHERE (coalesce(is_unavailable, false) OR coalesce(is_holiday, false)) AND visit_rate IS NOT NULL;
