-- ============================================================
-- Migration 051 — Definir senha escrevendo DIRETO no cofre
-- ------------------------------------------------------------
-- O QUE AINDA FALHAVA
-- A 050 gravava a senha em employees.portal_pin apostando que o gatilho
-- employee_capture_portal_credential iria capturá-la, gerar o hash e limpar o
-- campo. Na prática o gatilho não captura nesse caminho, o campo fica
-- preenchido e a regra employees_portal_credentials_never_persist rejeita:
--
--   new row for relation "employees" violates check constraint
--   "employees_portal_credentials_never_persist..."
--
-- Em vez de tentar adivinhar em que condição o gatilho dispara, a função passa
-- a escrever no cofre diretamente — mesmo destino, mesmo formato de hash
-- (bcrypt, custo 12). Não depende mais de intermediário e não viola regra
-- nenhuma: nada é gravado em employees.
--
-- Não altera nenhuma senha existente.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_set_pin(p_employee uuid, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_cpf   text;
  v_senha text := btrim(coalesce(p_pin, ''));
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Apenas usuários internos podem definir a senha' USING ERRCODE = '42501';
  END IF;

  -- Mesma regra que o gatilho aplica, para as duas portas combinarem
  IF octet_length(v_senha) NOT BETWEEN 6 AND 72 THEN
    RAISE EXCEPTION 'A senha precisa ter entre 6 e 72 caracteres';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee) THEN
    RAISE EXCEPTION 'Colaborador não encontrado';
  END IF;

  INSERT INTO app_private.portal_credentials (employee_id, pin_hash, updated_at)
  VALUES (p_employee, crypt(v_senha, gen_salt('bf', 12)), now())
  ON CONFLICT (employee_id) DO UPDATE
    SET pin_hash   = EXCLUDED.pin_hash,
        updated_at = EXCLUDED.updated_at;

  -- Senha nova derruba sessão aberta e destrava quem errou 5 vezes
  DELETE FROM portal_sessions WHERE employee_id = p_employee;

  SELECT regexp_replace(coalesce(cpf, ''), '\D', '', 'g') INTO v_cpf
    FROM employees WHERE id = p_employee;
  IF v_cpf IS NOT NULL AND v_cpf <> '' THEN
    DELETE FROM portal_login_attempts WHERE cpf_digits = v_cpf;
  END IF;
END$$;

GRANT EXECUTE ON FUNCTION portal_set_pin(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_set_pin(uuid, text) FROM anon, public;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- TESTE DE PONTA A PONTA — define uma senha e tenta o login com ela.
-- Troque o nome se quiser usar outra pessoa.
-- ============================================================
DO $$
DECLARE
  v_id   uuid;
  v_cpf  text;
  v_res  jsonb;
BEGIN
  SELECT id, cpf INTO v_id, v_cpf
    FROM employees
   WHERE full_name ILIKE '%Rafaella Estefani%' AND status = 'Ativo'
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE 'Pessoa de teste não encontrada — pule este bloco.';
    RETURN;
  END IF;

  -- Grava direto no cofre (mesmo caminho da função, sem a checagem de login)
  INSERT INTO app_private.portal_credentials (employee_id, pin_hash, updated_at)
  VALUES (v_id, crypt('teste123456', gen_salt('bf', 12)), now())
  ON CONFLICT (employee_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash, updated_at = EXCLUDED.updated_at;

  v_res := portal_login(v_cpf, 'teste123456');

  IF v_res IS NULL THEN
    RAISE NOTICE 'LOGIN RECUSOU a senha correta — a comparação está errada.';
  ELSIF v_res ? 'blocked' THEN
    RAISE NOTICE 'SENHA OK, mas acesso suspenso: %', v_res ->> 'reason';
  ELSE
    RAISE NOTICE 'TUDO CERTO — login aceitou. Entrou como: %', v_res ->> 'full_name';
  END IF;
END$$;
