-- ============================================================
-- Migration 042 — Contrato exigido no vínculo + validade de documento
-- ------------------------------------------------------------
-- 1) Ao vincular alguém a um cliente (freela ou permanente), o RH declara
--    se aquele vínculo EXIGE contrato assinado e em quantas horas ele
--    precisa estar em mãos. Antes isso só existia dentro do funil da vaga,
--    e vincular pela ficha não perguntava nada.
--
-- 2) Documento pode ter validade. Quando faltarem 10 dias para vencer,
--    aparece no painel. 10 dias porque há contratos de 30 dias — avisar
--    com 30/40 dias dispararia antes do contrato começar a valer.
--
-- 3) Se o vínculo exige contrato e ele NÃO está anexado, o portal da
--    pessoa não abre. Ela vê o motivo na tela de login, em vez de um
--    "senha incorreta" que não explica nada.
-- ============================================================

-- ── 1. Contrato exigido, por vínculo ─────────────────────────────────────
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS contract_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contract_deadline TIMESTAMPTZ;

COMMENT ON COLUMN employee_client_links.contract_required IS
  'Este vínculo exige contrato assinado em mãos. Sem ele o portal não abre.';
COMMENT ON COLUMN employee_client_links.contract_deadline IS
  'Prazo para o contrato assinado chegar. Vencido = alerta no painel.';

-- ── 2. Validade dos documentos ───────────────────────────────────────────
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS expires_at DATE;
ALTER TABLE shared_documents   ADD COLUMN IF NOT EXISTS expires_at DATE;

COMMENT ON COLUMN employee_documents.expires_at IS
  'Validade do documento. Nulo = não vence. Alerta 10 dias antes.';

-- ── 3. Portal bloqueado enquanto faltar contrato exigido ─────────────────
-- Devolve um motivo em vez de NULL, senão a pessoa vê "senha incorreta"
-- e liga para o RH achando que esqueceu a senha.
CREATE OR REPLACE FUNCTION portal_login(p_cpf text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp      employees;
  v_token    text;
  v_pendente text;
BEGIN
  SELECT * INTO v_emp FROM employees
   WHERE status = 'Ativo'
     AND regexp_replace(coalesce(cpf,''), '\D', '', 'g') = regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')
   LIMIT 1;

  IF v_emp.id IS NULL OR v_emp.portal_pin IS NULL OR v_emp.portal_pin <> p_pin THEN
    RETURN NULL;  -- não diferencia "não existe" de "senha errada"
  END IF;

  -- Vínculo ativo que exige contrato e está sem o arquivo anexado
  SELECT string_agg(c.name, ', ') INTO v_pendente
    FROM employee_client_links ecl
    JOIN clients c ON c.id = ecl.client_id
   WHERE ecl.employee_id = v_emp.id
     AND ecl.contract_required = TRUE
     AND ecl.contract_file_url IS NULL
     AND (ecl.contract_end_date IS NULL OR ecl.contract_end_date >= CURRENT_DATE);

  IF v_pendente IS NOT NULL THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'reason', 'Seu acesso será liberado assim que o RH anexar o contrato assinado (' || v_pendente || ').'
    );
  END IF;

  DELETE FROM portal_sessions WHERE employee_id = v_emp.id OR expires_at < now();

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  INSERT INTO portal_sessions(token, employee_id, expires_at)
  VALUES (v_token, v_emp.id, now() + interval '12 hours');

  RETURN jsonb_build_object('token', v_token, 'employee_id', v_emp.id, 'full_name', v_emp.full_name);
END$$;

GRANT EXECUTE ON FUNCTION portal_login(text, text) TO anon;

NOTIFY pgrst, 'reload schema';
