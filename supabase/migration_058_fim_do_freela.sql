-- ============================================================
-- Migration 058 — Fim do tipo "Freela": sobram Fixo e Consultoria
-- ------------------------------------------------------------
-- Decisão do Gabriel (28/09/2026): simplificar. Freela era o mesmo processo
-- com outro nome:
--   · freela de auditoria/consultoria  = Consultoria com data de fim
--     (paga por visita, como sempre)
--   · freela de cobertura/plantão      = Fixo "pago por diária"
--     (paga os dias trabalhados × diária, como sempre)
--
-- O que esta migração faz:
--   1. cria pay_mode no vínculo: 'mensal' (padrão) ou 'diaria'
--   2. cria is_temporary: vínculo que nasceu para acabar (cobertura/avulso)
--   3. guarda legacy_service_type = 'Volante' em quem era freela (rastro)
--   4. converte os vínculos Volante para Consultoria ou Fixo por diária
--
-- NADA é apagado. Visitas, pagamentos, agenda e documentos continuam ligados
-- ao mesmo vínculo (o id não muda). Valores (diária, unidades, datas) ficam.
-- ============================================================

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS pay_mode            text NOT NULL DEFAULT 'mensal',
  ADD COLUMN IF NOT EXISTS is_temporary        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_service_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecl_pay_mode_check') THEN
    ALTER TABLE employee_client_links
      ADD CONSTRAINT ecl_pay_mode_check CHECK (pay_mode IN ('mensal', 'diaria'));
  END IF;
END$$;

-- Antes de converter: quantos são
SELECT 'antes' AS momento,
       count(*) FILTER (WHERE service_type = 'Volante')                                   AS freelas,
       count(*) FILTER (WHERE service_type = 'Volante' AND coverage_type = 'Consultoria') AS viram_consultoria,
       count(*) FILTER (WHERE service_type = 'Volante' AND coalesce(coverage_type, 'Fixo') <> 'Consultoria') AS viram_fixo_diaria
  FROM employee_client_links;

-- Auditoria/consultoria → Consultoria (continua pagando por visita)
UPDATE employee_client_links
   SET legacy_service_type = 'Volante',
       is_temporary        = true,
       service_type        = 'Consultoria'
 WHERE service_type = 'Volante' AND coverage_type = 'Consultoria';

-- Cobertura/plantão → Fixo pago por diária (continua pagando dias × diária)
UPDATE employee_client_links
   SET legacy_service_type = 'Volante',
       is_temporary        = true,
       service_type        = 'Fixo',
       pay_mode            = 'diaria'
 WHERE service_type = 'Volante';


-- ============================================================
-- Funções do portal que desempatavam pelo 'Volante'
-- ============================================================
-- Quando a pessoa tem dois vínculos no mesmo cliente (ex.: consultoria fixa
-- + uma auditoria avulsa), o DIA decide de qual vínculo é a visita: se cai no
-- período do vínculo temporário, é dele. Antes isso era 'service_type =
-- Volante'; agora é is_temporary (e Volante continua valendo, por segurança).
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
  -- 1º: vínculo que vale NO DIA, temporário primeiro
  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = p_uid AND client_id = p_client
     AND (start_date IS NULL OR p_date >= start_date)
     AND (contract_end_date IS NULL OR p_date <= contract_end_date)
   ORDER BY (is_temporary OR service_type = 'Volante') DESC, start_date DESC NULLS LAST
   LIMIT 1;

  -- Sem vínculo no dia: o mais recente (mesmo comportamento de antes)
  IF v_link.id IS NULL THEN
    SELECT * INTO v_link FROM employee_client_links
     WHERE employee_id = p_uid AND client_id = p_client
     ORDER BY (is_temporary OR service_type = 'Volante') ASC, start_date DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_link.id IS NULL THEN RETURN NULL; END IF;

  -- Fixo (mensal ou por diária) não tem valor por visita: a folha paga
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
  IF v_quota IS NULL OR v_quota <= 0 THEN
    RETURN ROUND(v_unit_rate, 2);
  END IF;

  v_horas := portal_horas_liquidas(p_in, p_out, p_b1, p_b2);
  IF v_horas <= 0 THEN RETURN NULL; END IF;

  v_fator := LEAST(1, v_horas / v_quota);
  RETURN ROUND(v_unit_rate * v_fator, 2);
END$$;

CREATE OR REPLACE FUNCTION portal_save_visit(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  uid       uuid := portal_uid(p_token);
  v_id      uuid := nullif(p_payload->>'id','')::uuid;
  v_client  uuid := nullif(p_payload->>'client_id','')::uuid;
  v_unit    uuid := nullif(p_payload->>'unit_id','')::uuid;
  v_date    date := (p_payload->>'visit_date')::date;
  v_in      time := nullif(p_payload->>'check_in','')::time;
  v_out     time := nullif(p_payload->>'check_out','')::time;
  v_b1      time := nullif(p_payload->>'break_start','')::time;
  v_b2      time := nullif(p_payload->>'break_end','')::time;
  v_extra   boolean := coalesce((p_payload->>'is_extra')::boolean, false);
  v_rate       numeric;
  v_aprov      text;
  v_quota_mes  numeric;
  v_horas_mes  numeric;
  v_antigo     nutritionist_visits%ROWTYPE;
BEGIN
  PERFORM portal_assert_link(uid, v_client);

  IF v_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data';
  END IF;

  -- (2) O vínculo precisa estar valendo NO DIA da visita. Registrar atrasado,
  -- dentro do período, continua permitido.
  IF NOT EXISTS (
    SELECT 1 FROM employee_client_links
     WHERE employee_id = uid AND client_id = v_client
       AND (start_date IS NULL OR v_date >= start_date)
       AND (contract_end_date IS NULL OR v_date <= contract_end_date)
  ) THEN
    RAISE EXCEPTION 'Nesse dia você não tinha vínculo ativo com este cliente. Fale com o RH.';
  END IF;

  -- Falta ou feriado avisado com antecedência pode; trabalho no futuro, não
  IF v_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date
     AND NOT coalesce((p_payload->>'is_unavailable')::boolean, false)
     AND NOT coalesce((p_payload->>'is_holiday')::boolean, false) THEN
    RAISE EXCEPTION 'Não dá para registrar um dia que ainda não aconteceu.';
  END IF;

  IF NOT portal_mes_aberto(v_date) THEN
    RAISE EXCEPTION 'Esse mês já foi fechado. Para corrigir, fale com o RH.';
  END IF;

  -- (3) Alterar um registro: não pode se o mês fechou ou o chefe já decidiu o extra
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_antigo FROM nutritionist_visits WHERE id = v_id AND employee_id = uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado' USING ERRCODE = '42501'; END IF;
    IF NOT portal_mes_aberto(v_antigo.visit_date) THEN
      RAISE EXCEPTION 'Esse registro é de um mês já fechado. Para corrigir, fale com o RH.';
    END IF;
    IF v_antigo.extra_approval IN ('aprovada', 'negada') THEN
      RAISE EXCEPTION 'Esse registro já foi analisado pelo RH e não pode mais ser alterado.';
    END IF;
  END IF;

  -- (1) Mesmo dia, mesmo cliente, mesma unidade: já existe
  IF EXISTS (
    SELECT 1 FROM nutritionist_visits
     WHERE employee_id = uid AND client_id = v_client AND visit_date = v_date
       AND coalesce(unit_id::text, '') = coalesce(v_unit::text, '')
       AND (v_id IS NULL OR id <> v_id)
  ) THEN
    RAISE EXCEPTION 'Você já registrou esse dia neste cliente. Para mudar, edite o registro que já existe.';
  END IF;

  -- Valor: sempre calculado aqui, nunca vindo do celular
  v_rate := portal_calc_visit_rate(uid, v_client, v_unit, v_date, v_in, v_out, v_b1, v_b2);

  v_aprov := nullif(p_payload->>'extra_approval','');
  IF v_aprov IS NOT NULL AND v_aprov <> 'pendente' THEN v_aprov := 'pendente'; END IF;
  IF v_extra AND v_aprov IS NULL THEN v_aprov := 'pendente'; END IF;

  SELECT monthly_hours_quota INTO v_quota_mes
    FROM employee_client_links
   WHERE employee_id = uid AND client_id = v_client
   ORDER BY (is_temporary OR service_type = 'Volante') ASC, start_date DESC NULLS LAST
   LIMIT 1;

  IF v_quota_mes IS NOT NULL AND v_quota_mes > 0 THEN
    SELECT COALESCE(SUM(portal_horas_liquidas(check_in, check_out, break_start, break_end)), 0)
      INTO v_horas_mes
      FROM nutritionist_visits
     WHERE employee_id = uid AND client_id = v_client
       AND date_trunc('month', visit_date) = date_trunc('month', v_date)
       AND (v_id IS NULL OR id <> v_id);
    IF v_horas_mes + portal_horas_liquidas(v_in, v_out, v_b1, v_b2) > v_quota_mes + 1 THEN
      v_aprov := 'pendente';
    END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE nutritionist_visits SET
      client_id = v_client,
      visit_date = v_date,
      check_in = v_in, check_out = v_out, break_start = v_b1, break_end = v_b2,
      is_holiday = coalesce((p_payload->>'is_holiday')::boolean, false),
      is_unavailable = coalesce((p_payload->>'is_unavailable')::boolean, false),
      unavailability_reason = nullif(p_payload->>'unavailability_reason',''),
      observations = nullif(p_payload->>'observations',''),
      unit_id = v_unit,
      unit_name = nullif(p_payload->>'unit_name',''),
      visit_rate = CASE WHEN v_aprov = 'pendente' THEN NULL ELSE v_rate END,
      extra_approval = v_aprov,
      proposed_amount = CASE WHEN v_aprov = 'pendente' THEN v_rate ELSE NULL END,
      is_extra = v_extra,
      is_swap = coalesce((p_payload->>'is_swap')::boolean, false),
      swapped_from = nullif(p_payload->>'swapped_from','')::date
    WHERE id = v_id AND employee_id = uid;
    RETURN v_id;
  END IF;

  INSERT INTO nutritionist_visits (
    employee_id, client_id, visit_date, check_in, check_out, break_start, break_end,
    is_holiday, is_unavailable, unavailability_reason, observations, unit_id, unit_name,
    visit_rate, extra_approval, proposed_amount, is_extra, extra_amount, is_swap, swapped_from
  ) VALUES (
    uid, v_client, v_date, v_in, v_out, v_b1, v_b2,
    coalesce((p_payload->>'is_holiday')::boolean,false),
    coalesce((p_payload->>'is_unavailable')::boolean,false),
    nullif(p_payload->>'unavailability_reason',''), nullif(p_payload->>'observations',''),
    v_unit, nullif(p_payload->>'unit_name',''),
    CASE WHEN v_aprov = 'pendente' THEN NULL ELSE v_rate END,
    v_aprov,
    CASE WHEN v_aprov = 'pendente' THEN v_rate ELSE NULL END,
    v_extra,
    NULL,
    coalesce((p_payload->>'is_swap')::boolean,false),
    nullif(p_payload->>'swapped_from','')::date
  ) RETURNING id INTO v_id;
  RETURN v_id;
END$$;

GRANT EXECUTE ON FUNCTION portal_save_visit(text, jsonb) TO anon;

NOTIFY pgrst, 'reload schema';

-- Depois: não pode sobrar nenhum Volante
SELECT 'depois' AS momento,
       count(*) FILTER (WHERE service_type = 'Volante')                          AS freelas_restantes,
       count(*) FILTER (WHERE legacy_service_type = 'Volante' AND service_type = 'Consultoria') AS eram_freela_agora_consultoria,
       count(*) FILTER (WHERE legacy_service_type = 'Volante' AND pay_mode = 'diaria')          AS eram_freela_agora_fixo_diaria
  FROM employee_client_links;
