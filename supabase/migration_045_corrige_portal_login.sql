-- ============================================================
-- Migration 045 — CORREÇÃO URGENTE do login do portal
-- ------------------------------------------------------------
-- O QUE QUEBROU
-- A migração 042 recriou portal_login partindo da versão da 007, sem saber
-- que a 008 já havia endurecido essa função. Ao sobrescrever, perdemos:
--
--   1. LOGIN POR SENHA COM HASH (portal_pin_hash + crypt)
--      A 042 comparava só o texto puro (portal_pin). Quem já tinha a senha
--      convertida para hash tem portal_pin = NULL — e passou a cair no
--      "senha incorreta" mesmo digitando a senha certa. É o caso da
--      Vanielle e da Juciara.
--
--   2. BLOQUEIO POR TENTATIVAS (portal_login_attempts)
--      5 erros travavam o CPF por 15 minutos. Sem isso, dava pra tentar
--      senha infinitamente — o portal ficou aberto a força bruta.
--
-- Esta migração restaura os dois e mantém a trava de contrato da 042.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_login(p_cpf text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp      employees;
  v_token    text;
  v_digits   text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
  v_att      portal_login_attempts;
  v_ok       boolean := false;
  v_pendente text;
BEGIN
  -- Bloqueio por tentativas (por CPF) — restaurado da 008
  SELECT * INTO v_att FROM portal_login_attempts WHERE cpf_digits = v_digits;
  IF v_att.locked_until IS NOT NULL AND v_att.locked_until > now() THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente novamente em alguns minutos.' USING ERRCODE='28000';
  END IF;

  SELECT * INTO v_emp FROM employees
   WHERE status = 'Ativo'
     AND regexp_replace(coalesce(cpf,''), '\D', '', 'g') = v_digits
   LIMIT 1;

  -- Senha: hash primeiro; texto puro só como legado, migrando na hora
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

  -- Trava de contrato (da 042): vínculo ativo que exige contrato e está sem o arquivo.
  -- Vem DEPOIS da senha, para não revelar nada a quem errou a senha.
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

-- Conferência: quem está com senha em hash (estes eram os bloqueados)
SELECT full_name,
       (portal_pin_hash IS NOT NULL) AS senha_em_hash,
       (portal_pin IS NOT NULL)      AS senha_em_texto
FROM employees
WHERE status = 'Ativo' AND (portal_pin_hash IS NOT NULL OR portal_pin IS NOT NULL)
ORDER BY full_name;
