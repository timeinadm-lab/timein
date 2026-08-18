-- ============================================================
-- Migration 041 — O portal não decide mais quanto se paga
-- ------------------------------------------------------------
-- BURACO CORRIGIDO AQUI
-- portal_save_visit gravava direto do payload do navegador:
--     visit_rate, extra_amount, proposed_amount, extra_approval
--
-- Como a função é chamada com a role "anon" e o payload vem do front,
-- qualquer pessoa com o token do portal podia abrir o navegador e mandar:
--     visit_rate     = 999999      -> recebia o que quisesse
--     extra_approval = 'aprovada'  -> aprovava o proprio dia extra,
--                                     pulando a decisao do chefe
--
-- Agora o servidor RECALCULA o valor a partir do vinculo e ignora o que
-- vier do navegador nesses campos. A regra e a mesma da tela:
--     valor da unidade x (horas feitas / horas combinadas), teto 100%
--     sem horas combinadas -> valor cheio da unidade
--     vinculo Fixo -> sem visit_rate (a folha calcula pelo salario)
--
-- extra_approval nunca chega como 'aprovada' pelo portal: vira 'pendente'.
-- extra_amount so o admin define, entao sempre entra nulo.
-- ============================================================

-- Horas líquidas de um registro (desconta intervalo, trata virada de dia)
CREATE OR REPLACE FUNCTION portal_horas_liquidas(p_in time, p_out time, p_b1 time, p_b2 time)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE mins numeric;
BEGIN
  IF p_in IS NULL OR p_out IS NULL THEN RETURN 0; END IF;
  mins := EXTRACT(EPOCH FROM (p_out - p_in)) / 60;
  IF mins < 0 THEN mins := mins + 24 * 60; END IF;          -- virou o dia
  IF p_b1 IS NOT NULL AND p_b2 IS NOT NULL THEN
    mins := mins - GREATEST(0, EXTRACT(EPOCH FROM (p_b2 - p_b1)) / 60);
  END IF;
  RETURN GREATEST(0, mins) / 60;
END$$;

-- Valor da visita calculado NO SERVIDOR
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
  -- Pode haver mais de um vínculo no mesmo cliente (consultoria fixa + freela).
  -- O dia desempata: se cai na janela do freela, o registro é do freela.
  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = p_uid AND client_id = p_client
     AND service_type = 'Volante'
     AND (start_date IS NULL OR p_date >= start_date)
     AND (contract_end_date IS NULL OR p_date <= contract_end_date)
   LIMIT 1;

  IF v_link.id IS NULL THEN
    SELECT * INTO v_link FROM employee_client_links
     WHERE employee_id = p_uid AND client_id = p_client
     ORDER BY (service_type <> 'Volante') DESC
     LIMIT 1;
  END IF;

  IF v_link.id IS NULL THEN RETURN NULL; END IF;

  -- Fixo puro não tem valor por visita: a folha paga pelo salário
  IF COALESCE(v_link.coverage_type, v_link.service_type) = 'Fixo'
     AND v_link.service_type <> 'Consultoria' THEN
    RETURN NULL;
  END IF;

  -- Valor da unidade escolhida, dentro do vínculo
  SELECT (elem->>'visit_rate')::numeric INTO v_unit_rate
    FROM jsonb_array_elements(COALESCE(v_link.link_units, '[]'::jsonb)) elem
   WHERE (elem->>'unit_id')::uuid = p_unit
   LIMIT 1;

  IF v_unit_rate IS NULL OR v_unit_rate <= 0 THEN RETURN NULL; END IF;

  -- Sem horas combinadas, a visita vale o valor cheio
  v_quota := v_link.weekly_hours_quota;
  IF v_quota IS NULL OR v_quota <= 0 THEN
    RETURN ROUND(v_unit_rate, 2);
  END IF;

  v_horas := portal_horas_liquidas(p_in, p_out, p_b1, p_b2);
  IF v_horas <= 0 THEN RETURN NULL; END IF;

  v_fator := LEAST(1, v_horas / v_quota);
  RETURN ROUND(v_unit_rate * v_fator, 2);
END$$;

-- portal_save_visit: mesma assinatura, mas o dinheiro passa a ser do servidor
CREATE OR REPLACE FUNCTION portal_save_visit(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  PERFORM portal_assert_link(uid, v_client);

  -- IGNORA visit_rate do payload: recalcula aqui
  v_rate := portal_calc_visit_rate(uid, v_client, v_unit, v_date, v_in, v_out, v_b1, v_b2);

  -- O portal nunca aprova nada. Só pode deixar pendente (ou nada).
  v_aprov := nullif(p_payload->>'extra_approval','');
  IF v_aprov IS NOT NULL AND v_aprov <> 'pendente' THEN v_aprov := 'pendente'; END IF;
  IF v_extra AND v_aprov IS NULL THEN v_aprov := 'pendente'; END IF;

  -- Estourou o combinado de horas do mês? Vai pra aprovação do chefe.
  -- Confiar no front pra marcar isso deixava a brecha de simplesmente
  -- não mandar o campo e receber o excedente direto.
  SELECT monthly_hours_quota INTO v_quota_mes
    FROM employee_client_links
   WHERE employee_id = uid AND client_id = v_client
   ORDER BY (service_type <> 'Volante') DESC
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
      -- extra_amount é decisão do chefe: o portal nunca escreve
      is_swap = coalesce((p_payload->>'is_swap')::boolean, false),
      swapped_from = nullif(p_payload->>'swapped_from','')::date
    WHERE id = v_id AND employee_id = uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado' USING ERRCODE='42501'; END IF;
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
    NULL,                                   -- extra_amount: só o chefe define
    coalesce((p_payload->>'is_swap')::boolean,false),
    nullif(p_payload->>'swapped_from','')::date
  ) RETURNING id INTO v_id;
  RETURN v_id;
END$$;

GRANT EXECUTE ON FUNCTION portal_save_visit(text, jsonb) TO anon;

NOTIFY pgrst, 'reload schema';
