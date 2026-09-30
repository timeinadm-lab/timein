-- ============================================================
-- Migration 068 — Revisão do portal: travas e consistência com o sistema
-- ------------------------------------------------------------
-- Revisão completa do portal pedida pelo Gabriel (30/09/2026). O banco passa
-- a garantir as regras que antes só a tela garantia:
--
--  1. LOGIN com CPF repetido (ex.: Maria Fernanda tem dois cadastros): entrava
--     em qualquer um, às vezes no que não tem vínculo. Agora entra no cadastro
--     que tem vínculo valendo (e, empatando, no mais antigo).
--
--  2. REGISTRO DO DIA (portal_save_visit):
--     · Folga e falta só para quem recebe MENSAL (Fixo mensal e consultoria
--       com salário fixo). Por visita/diária: dia sem trabalho não é pago,
--       então não existe folga/falta a registrar.
--     · Trabalho exige entrada e saída.
--     · O mesmo dia no mesmo cliente não pode ter falta/folga E trabalho.
--     · A regra "passou das horas do mês → visita aguardando aprovação" vale
--       só para consultoria POR VISITA. Na consultoria com salário ela criava
--       "extras para aprovar" sem valor nenhum.
--
--  3. TROCA DE DIA pelo registro (portal_trocar_dia_agenda): não conferia nada.
--     Agora exige vínculo valendo no novo dia, mês aberto e visita ainda não
--     registrada.
--
--  4. TROCAR VISITA para outra unidade: a unidade tem que ser do cliente
--     escolhido (desde a 064 as unidades vêm do cadastro do cliente).
--
--  5. AVISOS (falta/troca na escala): conferem tipo, datas dentro do vínculo,
--     mês aberto e aviso repetido.
--
--  6. Funções internas de cálculo deixam de poder ser chamadas pela chave
--     pública (o portal continua usando-as por dentro, normalmente).
--
--  7. CORRIGE 3 vínculos gravados pela planilha (29/09): nela, o campo de
--     horas da consultoria é HORAS POR VISITA, e foi gravado o total da semana:
--     · Ana Carolina (SIG/TROFI - TEC e GUARAPIRANGA), "2x na semana (4h)":
--       estava 8h por visita → uma visita de 4h saía pela METADE do valor.
--       Passa a 4h por visita, 2 visitas por semana.
--     · Juliany (Espetaria Cons. Carrão, "48h mensais") e Vânia (Due Grani,
--       "7h na semana"): salário fixo, sem horas por visita definidas — o aviso
--       de jornada acusava toda visita. Ficam só com as horas do mês.
--     Não mexe em visitas já registradas.
-- ============================================================

-- ── Regras do tipo de vínculo (as mesmas de src/lib/utils.ts) ────────────
CREATE OR REPLACE FUNCTION vinculo_tipo(l employee_client_links)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN l.service_type = 'Volante' THEN CASE WHEN l.coverage_type = 'Consultoria' THEN 'Consultoria' ELSE 'Fixo' END
    WHEN l.service_type = 'Consultoria' THEN 'Consultoria'
    ELSE 'Fixo' END
$$;

-- Recebe mensal por contrato: Fixo mensal ou consultoria com salário fixo
CREATE OR REPLACE FUNCTION vinculo_recebe_mensal(l employee_client_links)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN vinculo_tipo(l) = 'Consultoria' THEN coalesce(l.pay_mode, '') = 'salario_fixo'
    WHEN l.service_type = 'Volante' THEN false
    ELSE coalesce(l.pay_mode, 'mensal') <> 'diaria' END
$$;


-- ── 1. Login ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_login(p_cpf text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp      employees;
  v_hash     text;
  v_token    text;
  v_digits   text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_att      portal_login_attempts;
  v_ok       boolean := false;
  v_pendente text;
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO v_att FROM portal_login_attempts WHERE cpf_digits = v_digits;
  IF v_att.locked_until IS NOT NULL AND v_att.locked_until > now() THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente novamente em alguns minutos.' USING ERRCODE = '28000';
  END IF;

  -- CPF repetido (cadastro duplicado): vale o que tem vínculo valendo hoje,
  -- depois o que tem algum vínculo, depois o mais antigo
  SELECT e.* INTO v_emp FROM employees e
   WHERE e.status = 'Ativo'
     AND regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = v_digits
   ORDER BY
     EXISTS (SELECT 1 FROM employee_client_links l WHERE l.employee_id = e.id
               AND (l.start_date IS NULL OR l.start_date <= v_hoje)
               AND (l.contract_end_date IS NULL OR l.contract_end_date >= v_hoje)) DESC,
     EXISTS (SELECT 1 FROM employee_client_links l WHERE l.employee_id = e.id) DESC,
     e.created_at ASC NULLS LAST
   LIMIT 1;

  IF v_emp.id IS NOT NULL THEN
    SELECT pin_hash INTO v_hash FROM app_private.portal_credentials WHERE employee_id = v_emp.id;
    IF v_hash IS NULL THEN
      SELECT default_pin_hash INTO v_hash FROM app_private.portal_config WHERE id;
    END IF;
    IF v_hash IS NOT NULL THEN
      v_ok := (crypt(btrim(coalesce(p_pin, '')), v_hash) = v_hash);
    END IF;
  END IF;

  IF NOT v_ok THEN
    INSERT INTO portal_login_attempts(cpf_digits, fails, locked_until)
      VALUES (v_digits, 1, NULL)
    ON CONFLICT (cpf_digits) DO UPDATE
      SET fails = portal_login_attempts.fails + 1,
          locked_until = CASE WHEN portal_login_attempts.fails + 1 >= 5
                              THEN now() + interval '15 minutes' ELSE NULL END;
    RETURN NULL;
  END IF;

  -- Contrato exigido e ainda não anexado: senha certa, mas acesso suspenso
  SELECT string_agg(c.name, ', ') INTO v_pendente
    FROM employee_client_links ecl
    JOIN clients c ON c.id = ecl.client_id
   WHERE ecl.employee_id = v_emp.id
     AND ecl.contract_required = TRUE
     AND ecl.contract_file_url IS NULL
     AND (ecl.contract_end_date IS NULL OR ecl.contract_end_date >= CURRENT_DATE);

  IF v_pendente IS NOT NULL THEN
    DELETE FROM portal_login_attempts WHERE cpf_digits = v_digits;
    RETURN jsonb_build_object(
      'blocked', true,
      'reason', 'Seu acesso será liberado assim que o RH anexar o contrato assinado (' || v_pendente || ').'
    );
  END IF;

  DELETE FROM portal_login_attempts WHERE cpf_digits = v_digits;
  DELETE FROM portal_sessions WHERE employee_id = v_emp.id OR expires_at < now();

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO portal_sessions(token, employee_id, expires_at)
  VALUES (v_token, v_emp.id, now() + interval '12 hours');

  RETURN jsonb_build_object('token', v_token, 'employee_id', v_emp.id, 'full_name', v_emp.full_name);
END$$;

GRANT EXECUTE ON FUNCTION portal_login(text, text) TO anon;


-- ── 2. Registro do dia ───────────────────────────────────────────────────
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
  v_falta   boolean := coalesce((p_payload->>'is_unavailable')::boolean, false);
  v_folga   boolean := coalesce((p_payload->>'is_holiday')::boolean, false);
  v_link       employee_client_links%ROWTYPE;
  v_rate       numeric;
  v_aprov      text;
  v_horas_mes  numeric;
  v_antigo     nutritionist_visits%ROWTYPE;
BEGIN
  PERFORM portal_assert_link(uid, v_client);

  IF v_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data';
  END IF;

  -- O vínculo precisa estar valendo NO DIA (registrar atrasado, dentro do período, pode)
  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = uid AND client_id = v_client
     AND (start_date IS NULL OR v_date >= start_date)
     AND (contract_end_date IS NULL OR v_date <= contract_end_date)
   ORDER BY (is_temporary OR service_type = 'Volante') DESC, start_date DESC NULLS LAST
   LIMIT 1;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Nesse dia você não tinha vínculo ativo com este cliente. Fale com o RH.';
  END IF;

  -- Folga/falta: só quem recebe mensal. Nunca as duas juntas; trabalho tem horário.
  IF v_falta AND v_folga THEN
    RAISE EXCEPTION 'Escolha falta ou folga, não as duas.';
  END IF;
  IF (v_falta OR v_folga) AND NOT vinculo_recebe_mensal(v_link) THEN
    RAISE EXCEPTION 'Folga e falta são só para quem recebe salário mensal. Se não trabalhou, é só não registrar o dia.';
  END IF;
  IF NOT (v_falta OR v_folga) AND (v_in IS NULL OR v_out IS NULL) THEN
    RAISE EXCEPTION 'Informe a entrada e a saída.';
  END IF;
  IF v_falta OR v_folga THEN
    v_in := NULL; v_out := NULL; v_b1 := NULL; v_b2 := NULL; v_unit := NULL; v_extra := false;
  END IF;

  -- Falta ou folga avisada com antecedência pode; trabalho no futuro, não
  IF v_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date AND NOT (v_falta OR v_folga) THEN
    RAISE EXCEPTION 'Não dá para registrar um dia que ainda não aconteceu.';
  END IF;

  IF NOT portal_mes_aberto(v_date) THEN
    RAISE EXCEPTION 'Esse mês já foi fechado. Para corrigir, fale com o RH.';
  END IF;

  -- Alterar um registro: não pode se o mês fechou ou o chefe já decidiu o extra
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

  -- Mesmo dia, mesmo cliente, mesma unidade: já existe
  IF EXISTS (
    SELECT 1 FROM nutritionist_visits
     WHERE employee_id = uid AND client_id = v_client AND visit_date = v_date
       AND coalesce(unit_id::text, '') = coalesce(v_unit::text, '')
       AND (v_id IS NULL OR id <> v_id)
  ) THEN
    RAISE EXCEPTION 'Você já registrou esse dia neste cliente. Para mudar, edite o registro que já existe.';
  END IF;

  -- Falta/folga e trabalho no mesmo dia e cliente se contradizem
  IF EXISTS (
    SELECT 1 FROM nutritionist_visits
     WHERE employee_id = uid AND client_id = v_client AND visit_date = v_date
       AND (v_id IS NULL OR id <> v_id)
       AND (v_falta OR v_folga OR coalesce(is_unavailable, false) OR coalesce(is_holiday, false))
  ) THEN
    RAISE EXCEPTION 'Esse dia já tem registro neste cliente. Falta ou folga não combinam com trabalho no mesmo dia: edite o registro que já existe.';
  END IF;

  -- Valor: sempre calculado aqui, nunca vindo do celular. Falta/folga não têm valor.
  v_rate := CASE WHEN v_falta OR v_folga THEN NULL
                 ELSE portal_calc_visit_rate(uid, v_client, v_unit, v_date, v_in, v_out, v_b1, v_b2) END;

  -- "Aguardando aprovação": dia extra do Fixo, ou consultoria POR VISITA que
  -- passou das horas do mês. Consultoria com salário não tem valor por visita.
  v_aprov := nullif(p_payload->>'extra_approval','');
  IF v_aprov IS NOT NULL AND v_aprov <> 'pendente' THEN v_aprov := 'pendente'; END IF;
  IF v_extra AND v_aprov IS NULL THEN v_aprov := 'pendente'; END IF;
  IF v_falta OR v_folga OR (vinculo_tipo(v_link) = 'Consultoria' AND v_link.pay_mode = 'salario_fixo' AND NOT v_extra) THEN
    v_aprov := NULL;
  END IF;

  IF NOT (v_falta OR v_folga)
     AND vinculo_tipo(v_link) = 'Consultoria' AND coalesce(v_link.pay_mode, '') <> 'salario_fixo'
     AND coalesce(v_link.monthly_hours_quota, 0) > 0 THEN
    SELECT COALESCE(SUM(portal_horas_liquidas(check_in, check_out, break_start, break_end)), 0)
      INTO v_horas_mes
      FROM nutritionist_visits
     WHERE employee_id = uid AND client_id = v_client
       AND date_trunc('month', visit_date) = date_trunc('month', v_date)
       AND NOT coalesce(is_unavailable, false) AND NOT coalesce(is_holiday, false)
       AND (v_id IS NULL OR id <> v_id);
    IF v_horas_mes + portal_horas_liquidas(v_in, v_out, v_b1, v_b2) > v_link.monthly_hours_quota + 1 THEN
      v_aprov := 'pendente';
    END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE nutritionist_visits SET
      client_id = v_client,
      visit_date = v_date,
      check_in = v_in, check_out = v_out, break_start = v_b1, break_end = v_b2,
      is_holiday = v_folga,
      is_unavailable = v_falta,
      unavailability_reason = nullif(p_payload->>'unavailability_reason',''),
      observations = nullif(p_payload->>'observations',''),
      unit_id = v_unit,
      unit_name = CASE WHEN v_unit IS NULL THEN NULL ELSE nullif(p_payload->>'unit_name','') END,
      visit_rate = CASE WHEN v_aprov = 'pendente' THEN NULL ELSE v_rate END,
      extra_approval = v_aprov,
      proposed_amount = CASE WHEN v_aprov = 'pendente' THEN coalesce(v_rate, nullif(p_payload->>'proposed_amount','')::numeric) ELSE NULL END,
      is_extra = v_extra,
      is_swap = CASE WHEN v_falta OR v_folga THEN false ELSE coalesce((p_payload->>'is_swap')::boolean, false) END,
      swapped_from = CASE WHEN v_falta OR v_folga THEN NULL ELSE nullif(p_payload->>'swapped_from','')::date END
    WHERE id = v_id AND employee_id = uid;
    RETURN v_id;
  END IF;

  INSERT INTO nutritionist_visits (
    employee_id, client_id, visit_date, check_in, check_out, break_start, break_end,
    is_holiday, is_unavailable, unavailability_reason, observations, unit_id, unit_name,
    visit_rate, extra_approval, proposed_amount, is_extra, extra_amount, is_swap, swapped_from
  ) VALUES (
    uid, v_client, v_date, v_in, v_out, v_b1, v_b2,
    v_folga, v_falta,
    nullif(p_payload->>'unavailability_reason',''), nullif(p_payload->>'observations',''),
    v_unit, CASE WHEN v_unit IS NULL THEN NULL ELSE nullif(p_payload->>'unit_name','') END,
    CASE WHEN v_aprov = 'pendente' THEN NULL ELSE v_rate END,
    v_aprov,
    CASE WHEN v_aprov = 'pendente' THEN coalesce(v_rate, nullif(p_payload->>'proposed_amount','')::numeric) ELSE NULL END,
    v_extra,
    NULL,
    CASE WHEN v_falta OR v_folga THEN false ELSE coalesce((p_payload->>'is_swap')::boolean, false) END,
    CASE WHEN v_falta OR v_folga THEN NULL ELSE nullif(p_payload->>'swapped_from','')::date END
  ) RETURNING id INTO v_id;
  RETURN v_id;
END$$;

GRANT EXECUTE ON FUNCTION portal_save_visit(text, jsonb) TO anon;


-- ── 3. Troca de dia feita ao registrar a visita ──────────────────────────
CREATE OR REPLACE FUNCTION portal_trocar_dia_agenda(p_token text, p_id uuid, p_nova_data date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid  uuid := portal_uid(p_token);
  v_ag nutritionist_agenda%ROWTYPE;
BEGIN
  SELECT * INTO v_ag FROM nutritionist_agenda WHERE id = p_id AND employee_id = uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado' USING ERRCODE = '42501'; END IF;
  IF p_nova_data IS NULL OR p_nova_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A troca é para o dia em que você foi.';
  END IF;
  IF NOT portal_mes_aberto(p_nova_data) OR NOT portal_mes_aberto(v_ag.planned_date) THEN
    RAISE EXCEPTION 'Esse mês já foi fechado. Para mudar, fale com o RH.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM employee_client_links
     WHERE employee_id = uid AND client_id = v_ag.client_id
       AND (start_date IS NULL OR p_nova_data >= start_date)
       AND (contract_end_date IS NULL OR p_nova_data <= contract_end_date)
  ) THEN
    RAISE EXCEPTION 'Nesse dia você não tinha vínculo com este cliente.';
  END IF;
  -- A visita combinada já foi registrada no dia dela: não há o que trocar
  IF EXISTS (SELECT 1 FROM nutritionist_visits
              WHERE employee_id = uid AND client_id = v_ag.client_id AND visit_date = v_ag.planned_date
                AND check_out IS NOT NULL AND NOT coalesce(is_unavailable, false)) THEN
    RAISE EXCEPTION 'A visita de % já foi registrada.', to_char(v_ag.planned_date, 'DD/MM');
  END IF;

  UPDATE nutritionist_agenda
     SET original_date     = COALESCE(original_date, planned_date),
         planned_date      = p_nova_data,
         rescheduled_at    = now(),
         changed_by_portal = true,
         change_seen_at    = NULL
   WHERE id = p_id AND employee_id = uid;
END$$;
GRANT EXECUTE ON FUNCTION portal_trocar_dia_agenda(text, uuid, date) TO anon;


-- ── 4. Trocar visita (cliente/unidade ou dia) ────────────────────────────
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

  IF EXISTS (SELECT 1 FROM nutritionist_visits
              WHERE employee_id = uid AND client_id = v_ag.client_id AND visit_date = v_ag.planned_date
                AND check_out IS NOT NULL AND NOT coalesce(is_unavailable, false)) THEN
    RAISE EXCEPTION 'Essa visita já foi registrada. Para corrigir, fale com o RH.';
  END IF;

  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = uid AND client_id = v_cli
     AND (start_date IS NULL OR v_data >= start_date)
     AND (contract_end_date IS NULL OR v_data <= contract_end_date)
   ORDER BY start_date DESC NULLS LAST
   LIMIT 1;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Você não tem vínculo com esse cliente nesse dia. Só dá para trocar para clientes em que você atua.';
  END IF;

  -- A unidade tem que ser do cliente escolhido (cadastro do cliente ou lista do vínculo)
  IF p_nova_unidade IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM client_units u WHERE u.id = p_nova_unidade AND u.client_id = v_cli)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_link.link_units, '[]'::jsonb)) u
                      WHERE (u->>'unit_id')::uuid = p_nova_unidade) THEN
    RAISE EXCEPTION 'Essa unidade não é deste cliente.';
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


-- ── 5. Avisos da escala (falta avisada / troca de dia) ──────────────────
CREATE OR REPLACE FUNCTION portal_save_notice(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid      uuid := portal_uid(p_token);
  v_client uuid := nullif(p_payload->>'client_id','')::uuid;
  v_tipo   text := p_payload->>'type';
  v_dia    date := nullif(p_payload->>'notice_date','')::date;
  v_troca  date := nullif(p_payload->>'swap_work_date','')::date;
  v_id     uuid;
BEGIN
  PERFORM portal_assert_link(uid, v_client);
  IF v_tipo NOT IN ('falta', 'troca') THEN RAISE EXCEPTION 'Tipo de aviso inválido'; END IF;
  IF v_dia IS NULL THEN RAISE EXCEPTION 'Informe o dia'; END IF;
  IF v_tipo = 'troca' AND (v_troca IS NULL OR v_troca = v_dia) THEN
    RAISE EXCEPTION 'Na troca, escolha o outro dia (diferente deste).';
  END IF;
  IF NOT portal_mes_aberto(v_dia) OR (v_troca IS NOT NULL AND NOT portal_mes_aberto(v_troca)) THEN
    RAISE EXCEPTION 'Esse mês já foi fechado. Fale com o RH.';
  END IF;
  -- Os dias do aviso têm que estar dentro do vínculo
  IF NOT EXISTS (SELECT 1 FROM employee_client_links
                  WHERE employee_id = uid AND client_id = v_client
                    AND (start_date IS NULL OR v_dia >= start_date)
                    AND (contract_end_date IS NULL OR v_dia <= contract_end_date))
     OR (v_troca IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employee_client_links
                  WHERE employee_id = uid AND client_id = v_client
                    AND (start_date IS NULL OR v_troca >= start_date)
                    AND (contract_end_date IS NULL OR v_troca <= contract_end_date))) THEN
    RAISE EXCEPTION 'Esse dia está fora do seu vínculo com este cliente.';
  END IF;
  IF EXISTS (SELECT 1 FROM schedule_notices
              WHERE employee_id = uid AND client_id = v_client
                AND (notice_date = v_dia OR swap_work_date = v_dia
                     OR (v_troca IS NOT NULL AND (notice_date = v_troca OR swap_work_date = v_troca)))) THEN
    RAISE EXCEPTION 'Já existe um aviso para esse dia. Cancele o anterior antes de criar outro.';
  END IF;

  INSERT INTO schedule_notices (employee_id, client_id, type, notice_date, swap_work_date, reason)
  VALUES (uid, v_client, v_tipo, v_dia, CASE WHEN v_tipo = 'troca' THEN v_troca END, nullif(p_payload->>'reason',''))
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;
GRANT EXECUTE ON FUNCTION portal_save_notice(text, jsonb) TO anon;


-- ── 6. Funções internas: só por dentro (o portal usa via funções portal_*) ──
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_calc_visit_rate(uuid, uuid, uuid, date, time, time, time, time)',
    'visita_excesso(uuid, uuid, uuid, date, text, text, text, text)',
    'valor_da_unidade(employee_client_links, uuid)',
    'vinculo_tipo(employee_client_links)',
    'vinculo_recebe_mensal(employee_client_links)'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, public', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
    EXCEPTION WHEN undefined_function THEN NULL;  -- migração anterior não rodada: ignora
    END;
  END LOOP;
END$$;

-- ── 7. Correção dos vínculos da planilha ─────────────────────────────────
UPDATE employee_client_links l
   SET weekly_hours_quota = 4, visits_per_week = 2, monthly_hours_quota = 32
  FROM employees e, clients c
 WHERE l.employee_id = e.id AND l.client_id = c.id
   AND regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = '43430832845'
   AND c.name ILIKE 'SIG/TROFI%'
   AND l.weekly_hours_quota = 8;

UPDATE employee_client_links l
   SET weekly_hours_quota = NULL, monthly_hours_quota = 48
  FROM employees e, clients c
 WHERE l.employee_id = e.id AND l.client_id = c.id
   AND regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = '43075054844'
   AND c.name ILIKE 'ESPETARIA CONS%'
   AND l.weekly_hours_quota = 48;

UPDATE employee_client_links l
   SET weekly_hours_quota = NULL, monthly_hours_quota = 28
  FROM employees e, clients c
 WHERE l.employee_id = e.id AND l.client_id = c.id
   AND regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = '21730573835'
   AND c.name ILIKE 'DUE GRANI%'
   AND l.pay_mode = 'salario_fixo'
   AND l.weekly_hours_quota = 7;

NOTIFY pgrst, 'reload schema';

-- Conferência: cadastros com CPF repetido (o login agora escolhe o que tem vínculo)
SELECT regexp_replace(coalesce(cpf, ''), '\D', '', 'g') AS cpf, count(*) AS cadastros,
       string_agg(full_name || ' (' || to_char(created_at, 'DD/MM/YY') || ')', ' · ') AS quem
  FROM employees
 WHERE status = 'Ativo' AND coalesce(cpf, '') <> ''
 GROUP BY 1 HAVING count(*) > 1;
