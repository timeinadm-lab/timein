-- ============================================================
-- Migration 060 — Consultoria com salário fixo + troca de visita pelo portal
-- ------------------------------------------------------------
-- Pedido do Gabriel (28/09/2026):
--
-- 1) CONSULTORIA COM SALÁRIO FIXO: a pessoa faz consultorias (o RH monta a
--    agenda), mas recebe um salário mensal — não por visita. O sistema
--    acompanha quantas consultorias foram programadas × realizadas.
--    → pay_mode = 'salario_fixo' em vínculo de Consultoria.
--
-- 2) TROCA DE VISITA: no portal, a pessoa pode trocar uma visita da agenda
--    para OUTRO DIA ou para OUTRO CLIENTE/UNIDADE — só entre clientes e
--    unidades a que ela está vinculada, com o vínculo valendo no dia. A troca
--    fica registrada (o que era antes, quando, motivo) e avisa a equipe
--    (sino) até alguém marcar como vista.
-- ============================================================

-- ── 1. Forma de pagamento ────────────────────────────────────────────────
ALTER TABLE employee_client_links DROP CONSTRAINT IF EXISTS ecl_pay_mode_check;
ALTER TABLE employee_client_links
  ADD CONSTRAINT ecl_pay_mode_check CHECK (pay_mode IN ('mensal', 'diaria', 'salario_fixo'));

-- ── 2. Rastro da troca na agenda ─────────────────────────────────────────
ALTER TABLE nutritionist_agenda
  ADD COLUMN IF NOT EXISTS original_date      date,
  ADD COLUMN IF NOT EXISTS rescheduled_at     timestamptz,
  ADD COLUMN IF NOT EXISTS original_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_unit_id   uuid,
  ADD COLUMN IF NOT EXISTS client_changed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS change_reason      text,
  ADD COLUMN IF NOT EXISTS changed_by_portal  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS change_seen_at     timestamptz;

-- ── 3. Troca de visita pelo portal ───────────────────────────────────────
-- Troca o dia, o cliente/unidade, ou os dois. Só para cliente/unidade de um
-- vínculo DELA que esteja valendo no novo dia. Vale também para a agenda
-- montada pelo RH (é justamente o caso: chegou no dia e não deu para ir).
CREATE OR REPLACE FUNCTION portal_trocar_visita(
  p_token text, p_id uuid, p_nova_data date, p_novo_cliente uuid, p_nova_unidade uuid, p_motivo text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid      uuid := portal_uid(p_token);
  v_ag     nutritionist_agenda%ROWTYPE;
  v_data   date;
  v_cli    uuid;
  v_link   employee_client_links%ROWTYPE;
  v_mudou_dia boolean;
  v_mudou_cli boolean;
BEGIN
  SELECT * INTO v_ag FROM nutritionist_agenda WHERE id = p_id AND employee_id = uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visita não encontrada' USING ERRCODE = '42501'; END IF;

  v_data := coalesce(p_nova_data, v_ag.planned_date);
  v_cli  := coalesce(p_novo_cliente, v_ag.client_id);
  v_mudou_dia := v_data IS DISTINCT FROM v_ag.planned_date;
  v_mudou_cli := v_cli IS DISTINCT FROM v_ag.client_id
              OR (p_nova_unidade IS NOT NULL AND p_nova_unidade IS DISTINCT FROM v_ag.unit_id);

  IF NOT v_mudou_dia AND NOT v_mudou_cli THEN
    RAISE EXCEPTION 'Nada foi alterado.';
  END IF;

  IF NOT portal_mes_aberto(v_data) OR NOT portal_mes_aberto(v_ag.planned_date) THEN
    RAISE EXCEPTION 'Esse mês já foi fechado. Para mudar, fale com o RH.';
  END IF;

  -- Já registrou essa visita? Então não é mais troca de agenda.
  IF EXISTS (SELECT 1 FROM nutritionist_visits
              WHERE employee_id = uid AND client_id = v_ag.client_id AND visit_date = v_ag.planned_date
                AND check_out IS NOT NULL AND NOT coalesce(is_unavailable, false)) THEN
    RAISE EXCEPTION 'Essa visita já foi registrada. Para corrigir, fale com o RH.';
  END IF;

  -- SÓ para cliente de um vínculo dela, valendo no dia
  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = uid AND client_id = v_cli
     AND (start_date IS NULL OR v_data >= start_date)
     AND (contract_end_date IS NULL OR v_data <= contract_end_date)
   ORDER BY start_date DESC NULLS LAST
   LIMIT 1;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Você não tem vínculo com esse cliente nesse dia. Só dá para trocar para clientes em que você atua.';
  END IF;

  -- Unidade: tem que ser uma das unidades do vínculo (quando o vínculo lista unidades)
  IF p_nova_unidade IS NOT NULL
     AND jsonb_array_length(coalesce(v_link.link_units, '[]'::jsonb)) > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_link.link_units) u WHERE (u->>'unit_id')::uuid = p_nova_unidade) THEN
    RAISE EXCEPTION 'Essa unidade não faz parte do seu vínculo com esse cliente.';
  END IF;

  UPDATE nutritionist_agenda SET
    original_date      = CASE WHEN v_mudou_dia THEN coalesce(original_date, planned_date) ELSE original_date END,
    rescheduled_at     = CASE WHEN v_mudou_dia THEN now() ELSE rescheduled_at END,
    original_client_id = CASE WHEN v_mudou_cli THEN coalesce(original_client_id, client_id) ELSE original_client_id END,
    original_unit_id   = CASE WHEN v_mudou_cli THEN coalesce(original_unit_id, unit_id) ELSE original_unit_id END,
    client_changed_at  = CASE WHEN v_mudou_cli THEN now() ELSE client_changed_at END,
    planned_date       = v_data,
    client_id          = v_cli,
    unit_id            = CASE WHEN v_mudou_cli THEN p_nova_unidade ELSE unit_id END,
    change_reason      = nullif(btrim(coalesce(p_motivo, '')), ''),
    changed_by_portal  = true,
    change_seen_at     = NULL
  WHERE id = p_id;
END$$;

GRANT EXECUTE ON FUNCTION portal_trocar_visita(text, uuid, date, uuid, uuid, text) TO anon;

-- A troca de dia feita ao registrar o ponto (044) também avisa a equipe
CREATE OR REPLACE FUNCTION portal_trocar_dia_agenda(p_token text, p_id uuid, p_nova_data date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  UPDATE nutritionist_agenda
     SET original_date     = COALESCE(original_date, planned_date),
         planned_date      = p_nova_data,
         rescheduled_at    = now(),
         changed_by_portal = true,
         change_seen_at    = NULL
   WHERE id = p_id AND employee_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado' USING ERRCODE = '42501';
  END IF;
END$$;
GRANT EXECUTE ON FUNCTION portal_trocar_dia_agenda(text, uuid, date) TO anon;

-- ── 4. Valor da visita: salário fixo não tem valor por visita ────────────
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

  SELECT (elem->>'visit_rate')::numeric INTO v_unit_rate
    FROM jsonb_array_elements(COALESCE(v_link.link_units, '[]'::jsonb)) elem
   WHERE (elem->>'unit_id')::uuid = p_unit
   LIMIT 1;

  IF v_unit_rate IS NULL OR v_unit_rate <= 0 THEN RETURN NULL; END IF;

  v_quota := v_link.weekly_hours_quota;
  IF v_quota IS NULL OR v_quota <= 0 THEN RETURN ROUND(v_unit_rate, 2); END IF;

  v_horas := portal_horas_liquidas(p_in, p_out, p_b1, p_b2);
  IF v_horas <= 0 THEN RETURN NULL; END IF;

  v_fator := LEAST(1, v_horas / v_quota);
  RETURN ROUND(v_unit_rate * v_fator, 2);
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência
SELECT (SELECT count(*) FROM nutritionist_agenda) AS itens_na_agenda,
       (SELECT count(*) FROM employee_client_links WHERE pay_mode = 'salario_fixo') AS consultorias_com_salario;
