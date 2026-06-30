-- ============================================================================
-- MIGRATION 008 — ENDURECIMENTO (storage privado, PIN com hash+bloqueio, papéis)
-- Rode inteiro no SQL Editor do Supabase. Idempotente. Requer a 007 já aplicada.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1) PIN: guardar só o HASH (nunca o número), com bloqueio por tentativas    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
ALTER TABLE employees ADD COLUMN IF NOT EXISTS portal_pin_hash text;

CREATE TABLE IF NOT EXISTS portal_login_attempts (
  cpf_digits   text PRIMARY KEY,
  fails        int NOT NULL DEFAULT 0,
  locked_until timestamptz
);
ALTER TABLE portal_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_login_attempts FROM anon;

-- Define/troca a senha do portal (só o RH logado chama). Guarda o hash.
CREATE OR REPLACE FUNCTION portal_set_pin(p_employee uuid, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Apenas usuários internos podem definir a senha' USING ERRCODE='42501';
  END IF;
  IF length(coalesce(p_pin,'')) < 6 THEN
    RAISE EXCEPTION 'A senha precisa de pelo menos 6 caracteres';
  END IF;
  UPDATE employees
     SET portal_pin_hash = crypt(p_pin, gen_salt('bf')),
         portal_pin = NULL  -- não guarda mais o texto puro
   WHERE id = p_employee;
END$$;

-- LOGIN reescrito: valida o hash, migra PINs antigos (texto) e bloqueia ataques.
CREATE OR REPLACE FUNCTION portal_login(p_cpf text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp employees;
  v_token text;
  v_digits text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
  v_att portal_login_attempts;
  v_ok boolean := false;
BEGIN
  -- bloqueio por tentativas (por CPF)
  SELECT * INTO v_att FROM portal_login_attempts WHERE cpf_digits = v_digits;
  IF v_att.locked_until IS NOT NULL AND v_att.locked_until > now() THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente novamente em alguns minutos.' USING ERRCODE='28000';
  END IF;

  SELECT * INTO v_emp FROM employees
   WHERE status = 'Ativo'
     AND regexp_replace(coalesce(cpf,''), '\D', '', 'g') = v_digits
   LIMIT 1;

  IF v_emp.id IS NOT NULL THEN
    IF v_emp.portal_pin_hash IS NOT NULL THEN
      v_ok := (crypt(p_pin, v_emp.portal_pin_hash) = v_emp.portal_pin_hash);
    ELSIF v_emp.portal_pin IS NOT NULL AND v_emp.portal_pin = p_pin THEN
      -- PIN antigo em texto: aceita uma vez e migra para hash
      v_ok := true;
      UPDATE employees SET portal_pin_hash = crypt(p_pin, gen_salt('bf')), portal_pin = NULL WHERE id = v_emp.id;
    END IF;
  END IF;

  IF NOT v_ok THEN
    -- conta a falha; bloqueia 15 min após 5 erros
    INSERT INTO portal_login_attempts(cpf_digits, fails, locked_until)
      VALUES (v_digits, 1, NULL)
    ON CONFLICT (cpf_digits) DO UPDATE
      SET fails = portal_login_attempts.fails + 1,
          locked_until = CASE WHEN portal_login_attempts.fails + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END;
    RETURN NULL;
  END IF;

  -- sucesso: zera tentativas e cria sessão
  DELETE FROM portal_login_attempts WHERE cpf_digits = v_digits;
  DELETE FROM portal_sessions WHERE employee_id = v_emp.id OR expires_at < now();
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  INSERT INTO portal_sessions(token, employee_id, expires_at)
  VALUES (v_token, v_emp.id, now() + interval '12 hours');

  RETURN jsonb_build_object('token', v_token, 'employee_id', v_emp.id, 'full_name', v_emp.full_name);
END$$;

GRANT EXECUTE ON FUNCTION portal_set_pin(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_set_pin(uuid, text) FROM anon, public;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2) PAPÉIS: separa chefe × recrutador no banco (não só na tela)             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION auth_is_chefe()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'chefe');
$$;
GRANT EXECUTE ON FUNCTION auth_is_chefe() TO authenticated;

-- Tabelas financeiras sensíveis: só chefe lê/escreve (recrutador nem pela API alcança).
-- (payment_dates/checks ficam como 'authenticated' porque são criados junto do vínculo,
--  que o recrutador pode cadastrar; os VALORES de fato ficam em payments/expenses.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments','employee_expenses'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_all_'||t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'chefe_only_'||t, t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (auth_is_chefe()) WITH CHECK (auth_is_chefe())', 'chefe_only_'||t, t);
    END IF;
  END LOOP;
END$$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3) STORAGE: buckets PRIVADOS + acesso só por URL assinada (temporária)      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Fecha os buckets (deixam de ser públicos)
UPDATE storage.buckets SET public = false
 WHERE id IN ('documentos','documentos do funcionário','fotos de funcionários','contratos','PDFs do cliente');

-- Limpa políticas antigas desses buckets
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname LIKE 'rh_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END$$;

-- RH logado: acesso total aos buckets do sistema (para gerar URL assinada e gerenciar)
CREATE POLICY "rh_auth_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id IN ('documentos','documentos do funcionário','fotos de funcionários','contratos','PDFs do cliente'))
  WITH CHECK (bucket_id IN ('documentos','documentos do funcionário','fotos de funcionários','contratos','PDFs do cliente'));

-- Portal (anon): só PODE ENVIAR arquivos (atestado/relatório/comprovante). Não pode listar/ler.
CREATE POLICY "rh_portal_upload" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id IN ('documentos','documentos do funcionário'));

-- ============================================================================
-- Pronto. Próximos passos no app: a versão nova usa portal_set_pin (senha com
-- hash) e URLs assinadas para abrir arquivos. Rode este arquivo e teste.
-- ============================================================================
