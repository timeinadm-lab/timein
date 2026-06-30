-- ============================================================================
-- MIGRATION 007 — BLINDAGEM DO PORTAL DO COLABORADOR
-- ----------------------------------------------------------------------------
-- Objetivo: o portal (colaborador) NÃO acessa mais nenhuma tabela direto com a
-- chave pública (anon). Ele só pode chamar as funções portal_* abaixo, que
-- validam a senha do lado do servidor (SECURITY DEFINER) e devolvem/alteram
-- APENAS os dados do próprio colaborador. Assim não existe porta do portal
-- para o sistema interno, e a chave pública não dá acesso a nada das tabelas.
--
-- O sistema interno (RH) continua igual: protegido por login real (authenticated).
-- Rode este arquivo inteiro no SQL Editor do Supabase. É idempotente.
-- ============================================================================

-- ── 1. Garante RLS LIGADO e remove qualquer política aberta (USING true) ──────
-- Tabelas que o portal toca + as que tinham política permissiva.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','employee_client_links','clients','client_units',
    'nutritionist_visits','nutritionist_agenda','schedule_notices',
    'employee_questions','employee_expenses','shared_documents'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END$$;

-- Remove políticas abertas criadas antes (anon conseguia tudo)
DROP POLICY IF EXISTS "schedule_notices_all" ON schedule_notices;
DROP POLICY IF EXISTS "shared_documents_all" ON shared_documents;

-- Política única: só usuário autenticado do RH acessa direto (anon fica de fora).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'nutritionist_visits','nutritionist_agenda','schedule_notices',
    'employee_questions','employee_expenses','shared_documents'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_all_'||t, t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')', 'auth_all_'||t, t);
    END IF;
  END LOOP;
END$$;

-- Tira privilégios diretos do anon nessas tabelas (cinto e suspensório com a RLS).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','employee_client_links','clients','client_units',
    'nutritionist_visits','nutritionist_agenda','schedule_notices',
    'employee_questions','employee_expenses','shared_documents'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END$$;

-- ── 2. Sessões do portal (token temporário, sem reenviar a senha) ─────────────
CREATE TABLE IF NOT EXISTS portal_sessions (
  token       text PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_sessions FROM anon;
CREATE INDEX IF NOT EXISTS idx_portal_sessions_emp ON portal_sessions(employee_id);

-- ── 3. Helper: resolve o colaborador a partir do token (ou barra) ─────────────
CREATE OR REPLACE FUNCTION portal_uid(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  SELECT employee_id INTO v_uid FROM portal_sessions
   WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada' USING ERRCODE = '28000';
  END IF;
  RETURN v_uid;
END$$;

-- Garante que o client_id pertence a um vínculo do colaborador (anti-falsificação)
CREATE OR REPLACE FUNCTION portal_assert_link(p_uid uuid, p_client uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_client IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM employee_client_links WHERE employee_id = p_uid AND client_id = p_client
  ) THEN
    RAISE EXCEPTION 'Cliente não vinculado a este colaborador' USING ERRCODE = '42501';
  END IF;
END$$;

-- ── 4. LOGIN: valida CPF+PIN no servidor e devolve um token ───────────────────
CREATE OR REPLACE FUNCTION portal_login(p_cpf text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp employees; v_token text;
BEGIN
  SELECT * INTO v_emp FROM employees
   WHERE status = 'Ativo'
     AND regexp_replace(coalesce(cpf,''), '\D', '', 'g') = regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')
   LIMIT 1;

  IF v_emp.id IS NULL OR v_emp.portal_pin IS NULL OR v_emp.portal_pin <> p_pin THEN
    RETURN NULL;  -- não diferencia "não existe" de "senha errada"
  END IF;

  -- limpa sessões velhas desse colaborador
  DELETE FROM portal_sessions WHERE employee_id = v_emp.id OR expires_at < now();

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  INSERT INTO portal_sessions(token, employee_id, expires_at)
  VALUES (v_token, v_emp.id, now() + interval '12 hours');

  RETURN jsonb_build_object('token', v_token, 'employee_id', v_emp.id, 'full_name', v_emp.full_name);
END$$;

CREATE OR REPLACE FUNCTION portal_logout(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM portal_sessions WHERE token = p_token;
END$$;

-- ── 5. LEITURA: dados base (vínculos, unidades, avisos, mensagens, agenda) ─────
CREATE OR REPLACE FUNCTION portal_base(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  RETURN jsonb_build_object(
    'links', (
      SELECT coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
                'client', (SELECT jsonb_build_object('id', c.id, 'name', c.name) FROM clients c WHERE c.id = l.client_id))), '[]'::jsonb)
      FROM employee_client_links l WHERE l.employee_id = uid),
    'units', (
      SELECT coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb)
      FROM client_units u
      WHERE u.client_id IN (SELECT client_id FROM employee_client_links WHERE employee_id = uid)),
    'notices', (
      SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.notice_date DESC), '[]'::jsonb)
      FROM schedule_notices n WHERE n.employee_id = uid),
    'questions', (
      SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC), '[]'::jsonb)
      FROM employee_questions q WHERE q.employee_id = uid),
    'agenda', (
      SELECT coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
                'client', (SELECT jsonb_build_object('name', c.name) FROM clients c WHERE c.id = a.client_id),
                'unit',   (SELECT jsonb_build_object('name', cu.name) FROM client_units cu WHERE cu.id = a.unit_id)
              ) ORDER BY a.planned_date), '[]'::jsonb)
      FROM nutritionist_agenda a
      WHERE a.employee_id = uid AND a.planned_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  );
END$$;

-- ── 6. LEITURA: registros e gastos de um mês ('YYYY-MM') ──────────────────────
CREATE OR REPLACE FUNCTION portal_month(p_token text, p_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  d_start date := (p_month || '-01')::date;
  d_end   date := ((p_month || '-01')::date + interval '1 month - 1 day')::date;
BEGIN
  RETURN jsonb_build_object(
    'visits', (
      SELECT coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object(
                'client', (SELECT jsonb_build_object('name', c.name) FROM clients c WHERE c.id = v.client_id)) ORDER BY v.visit_date), '[]'::jsonb)
      FROM nutritionist_visits v
      WHERE v.employee_id = uid AND v.visit_date BETWEEN d_start AND d_end),
    'expenses', (
      SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM employee_expenses e
      WHERE e.employee_id = uid AND e.reference_month = p_month)
  );
END$$;

-- ── 7. ESCRITA: registrar/editar visita (folha de ponto) ──────────────────────
CREATE OR REPLACE FUNCTION portal_save_visit(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_client uuid := nullif(p_payload->>'client_id','')::uuid;
BEGIN
  PERFORM portal_assert_link(uid, v_client);

  IF v_id IS NOT NULL THEN
    UPDATE nutritionist_visits SET
      client_id = v_client,
      visit_date = (p_payload->>'visit_date')::date,
      check_in = nullif(p_payload->>'check_in','')::time,
      check_out = nullif(p_payload->>'check_out','')::time,
      break_start = nullif(p_payload->>'break_start','')::time,
      break_end = nullif(p_payload->>'break_end','')::time,
      is_holiday = coalesce((p_payload->>'is_holiday')::boolean, false),
      is_unavailable = coalesce((p_payload->>'is_unavailable')::boolean, false),
      unavailability_reason = nullif(p_payload->>'unavailability_reason',''),
      observations = nullif(p_payload->>'observations',''),
      unit_id = nullif(p_payload->>'unit_id','')::uuid,
      unit_name = nullif(p_payload->>'unit_name',''),
      visit_rate = nullif(p_payload->>'visit_rate','')::numeric,
      extra_approval = nullif(p_payload->>'extra_approval',''),
      proposed_amount = nullif(p_payload->>'proposed_amount','')::numeric,
      is_extra = coalesce((p_payload->>'is_extra')::boolean, false),
      extra_amount = nullif(p_payload->>'extra_amount','')::numeric,
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
    uid, v_client, (p_payload->>'visit_date')::date,
    nullif(p_payload->>'check_in','')::time, nullif(p_payload->>'check_out','')::time,
    nullif(p_payload->>'break_start','')::time, nullif(p_payload->>'break_end','')::time,
    coalesce((p_payload->>'is_holiday')::boolean,false), coalesce((p_payload->>'is_unavailable')::boolean,false),
    nullif(p_payload->>'unavailability_reason',''), nullif(p_payload->>'observations',''),
    nullif(p_payload->>'unit_id','')::uuid, nullif(p_payload->>'unit_name',''),
    nullif(p_payload->>'visit_rate','')::numeric, nullif(p_payload->>'extra_approval',''),
    nullif(p_payload->>'proposed_amount','')::numeric, coalesce((p_payload->>'is_extra')::boolean,false),
    nullif(p_payload->>'extra_amount','')::numeric, coalesce((p_payload->>'is_swap')::boolean,false),
    nullif(p_payload->>'swapped_from','')::date
  ) RETURNING id INTO v_id;
  RETURN v_id;
END$$;

CREATE OR REPLACE FUNCTION portal_delete_visit(p_token text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  DELETE FROM nutritionist_visits WHERE id = p_id AND employee_id = uid;
END$$;

CREATE OR REPLACE FUNCTION portal_set_visit_file(p_token text, p_id uuid, p_field text, p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  IF p_field = 'atestado_url' THEN
    UPDATE nutritionist_visits SET atestado_url = p_url WHERE id = p_id AND employee_id = uid;
  ELSIF p_field = 'report_url' THEN
    UPDATE nutritionist_visits SET report_url = p_url WHERE id = p_id AND employee_id = uid;
  ELSE
    RAISE EXCEPTION 'Campo inválido' USING ERRCODE='42501';
  END IF;
END$$;

-- ── 8. ESCRITA: agenda (planejar / remarcar / apagar) ─────────────────────────
CREATE OR REPLACE FUNCTION portal_save_agenda(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  v_client uuid := nullif(p_payload->>'client_id','')::uuid;
  v_id uuid;
BEGIN
  PERFORM portal_assert_link(uid, v_client);
  INSERT INTO nutritionist_agenda (employee_id, client_id, unit_id, planned_date, notes)
  VALUES (uid, v_client, nullif(p_payload->>'unit_id','')::uuid, (p_payload->>'planned_date')::date, nullif(p_payload->>'notes',''))
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

CREATE OR REPLACE FUNCTION portal_reschedule_agenda(p_token text, p_id uuid, p_new_date date, p_original date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  UPDATE nutritionist_agenda
     SET planned_date = p_new_date,
         original_date = coalesce(original_date, p_original),
         rescheduled_at = now()
   WHERE id = p_id AND employee_id = uid;
END$$;

CREATE OR REPLACE FUNCTION portal_delete_agenda(p_token text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  DELETE FROM nutritionist_agenda WHERE id = p_id AND employee_id = uid;
END$$;

-- ── 9. ESCRITA: avisos (falta / troca) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_save_notice(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  v_client uuid := nullif(p_payload->>'client_id','')::uuid;
  v_id uuid;
BEGIN
  PERFORM portal_assert_link(uid, v_client);
  INSERT INTO schedule_notices (employee_id, client_id, type, notice_date, swap_work_date, reason)
  VALUES (uid, v_client, p_payload->>'type', (p_payload->>'notice_date')::date,
          nullif(p_payload->>'swap_work_date','')::date, nullif(p_payload->>'reason',''))
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

CREATE OR REPLACE FUNCTION portal_delete_notice(p_token text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  DELETE FROM schedule_notices WHERE id = p_id AND employee_id = uid;
END$$;

-- ── 10. ESCRITA: gastos e mensagens ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_add_expense(p_token text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token); v_id uuid;
BEGIN
  INSERT INTO employee_expenses (employee_id, description, amount, category, notes, reference_month)
  VALUES (uid, p_payload->>'description', (p_payload->>'amount')::numeric, p_payload->>'category',
          nullif(p_payload->>'notes',''), p_payload->>'reference_month')
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

CREATE OR REPLACE FUNCTION portal_set_expense_receipt(p_token text, p_id uuid, p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  UPDATE employee_expenses SET receipt_url = p_url WHERE id = p_id AND employee_id = uid;
END$$;

CREATE OR REPLACE FUNCTION portal_ask_question(p_token text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  INSERT INTO employee_questions (employee_id, message) VALUES (uid, p_message);
END$$;

-- ── 11. Permissões: anon SÓ pode executar as funções do portal ────────────────
REVOKE EXECUTE ON FUNCTION portal_uid(text) FROM anon, public;  -- helper interno
REVOKE EXECUTE ON FUNCTION portal_assert_link(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION portal_login(text, text)               TO anon;
GRANT EXECUTE ON FUNCTION portal_logout(text)                    TO anon;
GRANT EXECUTE ON FUNCTION portal_base(text)                      TO anon;
GRANT EXECUTE ON FUNCTION portal_month(text, text)               TO anon;
GRANT EXECUTE ON FUNCTION portal_save_visit(text, jsonb)         TO anon;
GRANT EXECUTE ON FUNCTION portal_delete_visit(text, uuid)        TO anon;
GRANT EXECUTE ON FUNCTION portal_set_visit_file(text, uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION portal_save_agenda(text, jsonb)        TO anon;
GRANT EXECUTE ON FUNCTION portal_reschedule_agenda(text, uuid, date, date) TO anon;
GRANT EXECUTE ON FUNCTION portal_delete_agenda(text, uuid)       TO anon;
GRANT EXECUTE ON FUNCTION portal_save_notice(text, jsonb)        TO anon;
GRANT EXECUTE ON FUNCTION portal_delete_notice(text, uuid)       TO anon;
GRANT EXECUTE ON FUNCTION portal_add_expense(text, jsonb)        TO anon;
GRANT EXECUTE ON FUNCTION portal_set_expense_receipt(text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION portal_ask_question(text, text)        TO anon;

-- ============================================================================
-- Pronto. Depois de rodar: o portal só funciona pela versão nova do código
-- (que chama portal_*). A chave pública (anon) não lê mais nenhuma tabela.
-- ============================================================================
