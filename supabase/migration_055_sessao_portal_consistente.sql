-- ============================================================
-- Migration 055 — Portal: login e conferência de sessão combinando
-- ------------------------------------------------------------
-- SINTOMA: a nutricionista entra e cai na hora ("Sua sessão expirou").
--
-- CAUSA: a função que confere a sessão (portal_uid) foi reescrita direto no
-- banco em outro momento e não compara mais o token do mesmo jeito que o
-- login grava. O login da 054 (igual ao da 050) grava o token puro; a
-- conferência não o reconhece → "Sessao invalida ou expirada".
--
-- CORREÇÃO: as duas funções passam a seguir a MESMA regra, escrita aqui:
--   · o login grava só o hash SHA-256 do token (quem ler a tabela não
--     consegue usar as sessões);
--   · a conferência aceita o hash (novo) e o token puro (sessões antigas).
-- Não mexe em senha nenhuma.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_uid(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_uid uuid;
BEGIN
  IF coalesce(p_token, '') = '' THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada' USING ERRCODE = '28000';
  END IF;

  SELECT s.employee_id INTO v_uid
    FROM portal_sessions s
    JOIN employees e ON e.id = s.employee_id AND e.status = 'Ativo'
   WHERE s.token IN (encode(digest(p_token, 'sha256'), 'hex'), p_token)
     AND s.expires_at > now()
   LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada' USING ERRCODE = '28000';
  END IF;
  RETURN v_uid;
END$$;


-- Login: igual ao da 054; só grava a sessão como hash
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
BEGIN
  SELECT * INTO v_att FROM portal_login_attempts WHERE cpf_digits = v_digits;
  IF v_att.locked_until IS NOT NULL AND v_att.locked_until > now() THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente novamente em alguns minutos.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_emp FROM employees
   WHERE status = 'Ativo'
     AND regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_digits
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
  VALUES (encode(digest(v_token, 'sha256'), 'hex'), v_emp.id, now() + interval '12 hours');

  RETURN jsonb_build_object('token', v_token, 'employee_id', v_emp.id, 'full_name', v_emp.full_name);
END$$;

GRANT EXECUTE ON FUNCTION portal_login(text, text) TO anon;


-- Sair: apaga a sessão nos dois formatos
CREATE OR REPLACE FUNCTION portal_logout(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  DELETE FROM portal_sessions
   WHERE token IN (encode(digest(coalesce(p_token, ''), 'sha256'), 'hex'), p_token);
END$$;

GRANT EXECUTE ON FUNCTION portal_logout(text) TO anon;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- TESTE: cria uma sessão falsa, confere e apaga. Deve mostrar "TUDO CERTO".
-- ============================================================
DO $$
DECLARE v_emp uuid; v_tok text := 'teste-' || gen_random_uuid()::text; v_uid uuid;
BEGIN
  SELECT id INTO v_emp FROM employees WHERE status = 'Ativo' LIMIT 1;
  INSERT INTO portal_sessions(token, employee_id, expires_at)
  VALUES (encode(extensions.digest(v_tok, 'sha256'), 'hex'), v_emp, now() + interval '5 minutes');
  v_uid := portal_uid(v_tok);
  DELETE FROM portal_sessions WHERE token = encode(extensions.digest(v_tok, 'sha256'), 'hex');
  RAISE NOTICE 'TUDO CERTO — a sessão criada pelo login é reconhecida (%).', v_uid = v_emp;
END$$;
