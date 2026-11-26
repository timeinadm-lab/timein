-- ============================================================
-- Migration 116 — Carência de 1 dia para fechar a folha no portal
-- ------------------------------------------------------------
-- Pedido do dono: se o contrato acaba no dia N (contract_end_date = N, último
-- dia trabalhado), a pessoa ainda entra no portal e vê/fecha a folha desse
-- vínculo até o fim do dia N+1, no horário de Brasília (America/Sao_Paulo).
-- No dia N+2 o cliente some.
--
-- NÃO muda a data de fim, pagamento, nem o que é "vínculo encerrado".
-- NÃO libera ponto, visita, troca ou aviso com data posterior ao fim
-- (portal_save_visit e as outras travas de data ficam como estão).
--
-- O que muda:
--   1. portal_pode_acessar(p_fim): sem fim, ou fim >= hoje em Brasília menos 1.
--   2. O desempate de CPF repetido no portal_login passa a contar o vínculo
--      que acabou ontem (antes exigia contract_end_date >= hoje, então no dia
--      seguinte o cadastro certo perdia para outro).
--   3. A trava "contrato exigido e ainda não anexado" usava CURRENT_DATE
--      (no Supabase isso é UTC: depois das 21h em Brasília já é o dia
--      seguinte). Passa a usar o mesmo "hoje" de Brasília. Sem a carência:
--      no dia N+1 o contrato já acabou, e a pessoa precisa entrar para fechar
--      a folha mesmo que o arquivo não tenha sido anexado.
--
-- Pode rodar mais de uma vez. Não apaga nem altera dados.
-- APLICAR NO BANCO DEPOIS DA REVISÃO — esta migração não foi executada
-- no projeto ao ser escrita.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_pode_acessar(p_fim date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_fim IS NULL
      OR p_fim >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1);
$$;

REVOKE ALL ON FUNCTION portal_pode_acessar(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_pode_acessar(date) FROM anon;
GRANT EXECUTE ON FUNCTION portal_pode_acessar(date) TO authenticated;


-- Login: igual à migração 068, com o desempate e a trava de contrato acima.
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

  -- CPF repetido (cadastro duplicado): vale o que ainda pode abrir a folha
  -- (vínculo em vigor ou no dia de carência), depois o que tem algum vínculo,
  -- depois o mais antigo. Entrar no portal em si continua exigindo só status Ativo.
  SELECT e.* INTO v_emp FROM employees e
   WHERE e.status = 'Ativo'
     AND regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = v_digits
   ORDER BY
     EXISTS (SELECT 1 FROM employee_client_links l WHERE l.employee_id = e.id
               AND (l.start_date IS NULL OR l.start_date <= v_hoje)
               AND portal_pode_acessar(l.contract_end_date)) DESC,
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
  -- enquanto o contrato está em vigor (último dia inclusive), em Brasília.
  SELECT string_agg(c.name, ', ') INTO v_pendente
    FROM employee_client_links ecl
    JOIN clients c ON c.id = ecl.client_id
   WHERE ecl.employee_id = v_emp.id
     AND ecl.contract_required = TRUE
     AND ecl.contract_file_url IS NULL
     AND (ecl.contract_end_date IS NULL OR ecl.contract_end_date >= v_hoje);

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

NOTIFY pgrst, 'reload schema';

-- Conferência (não grava nada). Esperado: true, true, true, false.
SELECT portal_pode_acessar(NULL) AS sem_fim,
       portal_pode_acessar((now() AT TIME ZONE 'America/Sao_Paulo')::date) AS fim_hoje,
       portal_pode_acessar((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS fim_ontem,
       portal_pode_acessar((now() AT TIME ZONE 'America/Sao_Paulo')::date - 2) AS fim_anteontem;
