-- ============================================================
-- Migration 050 — Senha do portal: falar com o cofre, não brigar com ele
-- ------------------------------------------------------------
-- CONTEXTO
-- O banco passou a guardar as senhas do portal em app_private.portal_credentials
-- (um schema privado), e um gatilho em employees impede que qualquer coisa grave
-- senha direto na tabela. É um desenho melhor que o anterior.
--
-- A migração 049 recriou portal_set_pin e portal_login na versão ANTIGA, que
-- usava employees.portal_pin_hash. Resultado:
--   · criar senha dava "Use portal_set_pin para definir a senha do portal"
--   · e o login não encontraria senha nenhuma, porque procurava no lugar errado
--
-- Esta migração alinha as duas funções ao cofre. Não altera nenhuma senha
-- existente e não desfaz nada do que o gatilho protege.
-- ============================================================

-- Segurança: se o cofre não existir, para aqui em vez de fazer besteira.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'app_private' AND table_name = 'portal_credentials'
  ) THEN
    RAISE EXCEPTION 'app_private.portal_credentials não existe — não rode esta migração neste banco.';
  END IF;
END$$;


-- ── 1. Definir a senha (RH) ──────────────────────────────────────────────
-- Não grava o hash: entrega a senha em texto ao gatilho, que valida, gera o
-- hash e guarda no cofre. Um caminho só para gerar credencial, que é o que o
-- desenho novo quer garantir.
CREATE OR REPLACE FUNCTION portal_set_pin(p_employee uuid, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_cpf text;
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Apenas usuários internos podem definir a senha' USING ERRCODE = '42501';
  END IF;

  IF octet_length(coalesce(p_pin, '')) < 6 THEN
    RAISE EXCEPTION 'A senha precisa de pelo menos 6 caracteres';
  END IF;

  UPDATE employees SET portal_pin = p_pin WHERE id = p_employee;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado';
  END IF;

  -- Senha nova destrava quem tinha errado 5 vezes
  SELECT regexp_replace(coalesce(cpf, ''), '\D', '', 'g') INTO v_cpf
    FROM employees WHERE id = p_employee;
  IF v_cpf IS NOT NULL AND v_cpf <> '' THEN
    DELETE FROM portal_login_attempts WHERE cpf_digits = v_cpf;
  END IF;
END$$;

GRANT EXECUTE ON FUNCTION portal_set_pin(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_set_pin(uuid, text) FROM anon, public;


-- ── 2. Login (colaboradora) ──────────────────────────────────────────────
-- Confere a senha no cofre. Mantém o bloqueio por tentativas e a trava de
-- contrato pendente, que já existiam.
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
    IF v_hash IS NOT NULL THEN
      v_ok := (crypt(p_pin, v_hash) = v_hash);
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


-- ── 3. "Essa pessoa tem senha?" ──────────────────────────────────────────
-- A tela do RH olhava employees.portal_pin_hash, que neste desenho é sempre
-- nulo — então dizia "sem senha definida" mesmo para quem tem. Responde
-- sim/não sem expor o hash.
CREATE OR REPLACE FUNCTION portal_has_pin(p_employee uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM app_private.portal_credentials
     WHERE employee_id = p_employee AND pin_hash IS NOT NULL
  );
END$$;

GRANT EXECUTE ON FUNCTION portal_has_pin(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_has_pin(uuid) FROM anon, public;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA
-- ============================================================
SELECT 'quem já tem senha no cofre' AS item, count(*)::text AS valor
  FROM app_private.portal_credentials WHERE pin_hash IS NOT NULL
UNION ALL
SELECT 'colaboradores ativos', count(*)::text FROM employees WHERE status = 'Ativo';
