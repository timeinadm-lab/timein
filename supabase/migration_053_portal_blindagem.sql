-- ============================================================
-- Migration 053 — Raio-X do portal e da folha: blindagem no banco
-- ------------------------------------------------------------
-- Falhas que o banco aceitava e que viravam dinheiro errado:
--
--  1. O mesmo dia podia ser registrado DUAS vezes. No celular, com internet
--     lenta, tocar "Salvar" de novo criava outra visita — e as duas eram pagas.
--  2. Dava para registrar visita num cliente cujo vínculo já tinha acabado
--     (a tela escondia, mas o banco aceitava).
--  3. A nutricionista podia APAGAR ou ALTERAR qualquer visita dela — inclusive
--     de meses já pagos e extras que o chefe já tinha aprovado. O histórico de
--     pagamento deixava de bater com as visitas.
--  4. Gastos eram guardados só por pessoa. Quem tem dois vínculos aparecia em
--     duas linhas da folha e os mesmos gastos entravam nas duas — pagos em
--     dobro. Agora o gasto pode dizer de qual cliente é.
--
-- Não altera nenhum dado existente.
-- ============================================================


-- ── 4. Gasto passa a saber de qual cliente é ─────────────────────────────
ALTER TABLE employee_expenses
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;


-- ── Regra de "mês fechado" usada pelo portal ─────────────────────────────
-- A nutricionista mexe no mês atual e no anterior (consultoria da 2ª quinzena
-- só é paga no dia 8 do mês seguinte). Antes disso, só o RH altera.
CREATE OR REPLACE FUNCTION portal_mes_aberto(p_date date)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_date >= (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month')::date
$$;


-- ── 1, 2 e 3: salvar visita pelo portal ──────────────────────────────────
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

  IF v_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
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


-- ── 3. Apagar visita pelo portal: só de mês aberto e não analisada ────────
CREATE OR REPLACE FUNCTION portal_delete_visit(p_token text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  v   nutritionist_visits%ROWTYPE;
BEGIN
  SELECT * INTO v FROM nutritionist_visits WHERE id = p_id AND employee_id = uid;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT portal_mes_aberto(v.visit_date) THEN
    RAISE EXCEPTION 'Esse registro é de um mês já fechado. Para corrigir, fale com o RH.';
  END IF;
  IF v.extra_approval IN ('aprovada', 'negada') THEN
    RAISE EXCEPTION 'Esse registro já foi analisado pelo RH e não pode ser excluído.';
  END IF;

  DELETE FROM nutritionist_visits WHERE id = p_id AND employee_id = uid;
END$$;

GRANT EXECUTE ON FUNCTION portal_delete_visit(text, uuid) TO anon;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA — visitas que JÁ estão duplicadas hoje (mesmo dia/cliente/unidade)
-- Se aparecer alguma, avise o RH: pode ter sido paga em dobro.
-- ============================================================
SELECT e.full_name AS colaborador, c.name AS cliente, v.visit_date AS dia,
       count(*) AS registros, sum(coalesce(v.visit_rate,0)) AS valor_somado
  FROM nutritionist_visits v
  JOIN employees e ON e.id = v.employee_id
  JOIN clients   c ON c.id = v.client_id
 GROUP BY e.full_name, c.name, v.visit_date, coalesce(v.unit_id::text, '')
HAVING count(*) > 1
 ORDER BY v.visit_date DESC;
