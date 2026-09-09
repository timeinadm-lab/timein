-- ============================================================
-- Migration 049 — CORREÇÃO URGENTE: "function gen_salt(unknown) does not exist"
-- ------------------------------------------------------------
-- O QUE QUEBROU
-- As migrações 045 (portal_login) e 046 (portal_set_pin) declararam as funções
-- com SET search_path = public. No Supabase o pgcrypto mora no schema
-- "extensions", não em "public" — então crypt() e gen_salt() deixaram de ser
-- encontrados dentro dessas funções.
--
-- Efeito prático:
--   · Criar senha do portal falhava com "function gen_salt(unknown) does not exist"
--   · E o login de quem TIVESSE senha falharia pelo mesmo motivo — só não
--     apareceu antes porque ninguém tinha senha cadastrada ainda.
--
-- A migração 010 (PIN de exclusão) já fazia certo: "public, extensions".
-- Esta migração alinha as duas funções de senha ao mesmo padrão.
--
-- Não altera nenhum dado. Só recria as duas funções.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── Definir a senha do portal (RH) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_set_pin(p_employee uuid, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_cpf text;
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Apenas usuários internos podem definir a senha' USING ERRCODE='42501';
  END IF;

  UPDATE employees
     SET portal_pin_hash = crypt(p_pin, gen_salt('bf')),
         portal_pin      = NULL          -- nunca guarda a senha em texto
   WHERE id = p_employee
  RETURNING regexp_replace(coalesce(cpf,''), '\D', '', 'g') INTO v_cpf;

  -- Senha nova zera o contador de tentativas erradas (destrava a pessoa)
  IF v_cpf IS NOT NULL AND v_cpf <> '' THEN
    DELETE FROM portal_login_attempts WHERE cpf_digits = v_cpf;
  END IF;
END$$;

GRANT EXECUTE ON FUNCTION portal_set_pin(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_set_pin(uuid, text) FROM anon, public;


-- ── Login do portal (colaboradora) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_login(p_cpf text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp      employees;
  v_token    text;
  v_digits   text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
  v_att      portal_login_attempts;
  v_ok       boolean := false;
  v_pendente text;
BEGIN
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
      v_ok := true;
      UPDATE employees SET portal_pin_hash = crypt(p_pin, gen_salt('bf')), portal_pin = NULL WHERE id = v_emp.id;
    END IF;
  END IF;

  IF NOT v_ok THEN
    INSERT INTO portal_login_attempts(cpf_digits, fails, locked_until)
      VALUES (v_digits, 1, NULL)
    ON CONFLICT (cpf_digits) DO UPDATE
      SET fails = portal_login_attempts.fails + 1,
          locked_until = CASE WHEN portal_login_attempts.fails + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END;
    RETURN NULL;
  END IF;

  -- Trava de contrato: vínculo em vigor que exige contrato e está sem o arquivo
  SELECT string_agg(c.name, ', ') INTO v_pendente
    FROM employee_client_links ecl
    JOIN clients c ON c.id = ecl.client_id
   WHERE ecl.employee_id = v_emp.id
     AND ecl.contract_required = TRUE
     AND ecl.contract_file_url IS NULL
     AND (ecl.contract_end_date IS NULL OR ecl.contract_end_date >= CURRENT_DATE);

  IF v_pendente IS NOT NULL THEN
    DELETE FROM portal_login_attempts WHERE cpf_digits = v_digits;  -- a senha estava certa
    RETURN jsonb_build_object(
      'blocked', true,
      'reason', 'Seu acesso será liberado assim que o RH anexar o contrato assinado (' || v_pendente || ').'
    );
  END IF;

  DELETE FROM portal_login_attempts WHERE cpf_digits = v_digits;
  DELETE FROM portal_sessions WHERE employee_id = v_emp.id OR expires_at < now();

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  INSERT INTO portal_sessions(token, employee_id, expires_at)
  VALUES (v_token, v_emp.id, now() + interval '12 hours');

  RETURN jsonb_build_object('token', v_token, 'employee_id', v_emp.id, 'full_name', v_emp.full_name);
END$$;

GRANT EXECUTE ON FUNCTION portal_login(text, text) TO anon;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA — as duas funções enxergam a criptografia agora?
-- ============================================================
SELECT p.proname AS funcao,
       array_to_string(p.proconfig, ', ') AS search_path,
       CASE WHEN array_to_string(p.proconfig, ',') LIKE '%extensions%'
            THEN 'OK' ELSE '>>> AINDA SEM extensions' END AS situacao
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('portal_login', 'portal_set_pin', 'set_delete_pin', 'verify_delete_pin')
 ORDER BY p.proname;
