-- ============================================================
-- Migration 054 — Senha padrão do portal da nutricionista
-- ------------------------------------------------------------
-- Pedido do Gabriel (28/09/2026): uma senha igual para todas as
-- nutricionistas, que o RH troca dentro do sistema (Usuários).
--
-- Como funciona:
--   · A senha padrão fica guardada só como hash (bcrypt), no cofre
--     app_private — nunca em texto, nunca no código.
--   · No login, quem NÃO tem senha própria entra com a padrão.
--   · O RH ainda pode dar uma senha própria para uma pessoa (ficha > Portal)
--     e depois voltá-la para a padrão.
--   · "Aplicar a todos" apaga as senhas próprias: todo mundo passa a usar a
--     padrão.
--
-- A SENHA NÃO ESTÁ AQUI. Depois de rodar, defina em Usuários > Senha padrão
-- do portal.
-- ============================================================

-- Segurança: se o cofre não existir, para aqui.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'app_private' AND table_name = 'portal_credentials'
  ) THEN
    RAISE EXCEPTION 'app_private.portal_credentials não existe — não rode esta migração neste banco.';
  END IF;
END$$;


-- ── 1. Onde a senha padrão fica (uma linha só) ───────────────────────────
CREATE TABLE IF NOT EXISTS app_private.portal_config (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_pin_hash text,
  updated_at       timestamptz,
  updated_by       uuid
);


-- Quem pode mexer: chefe (inclui contabilidade, que herda o acesso do chefe)
CREATE OR REPLACE FUNCTION rh_eh_chefe()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE id = auth.uid() AND role IN ('chefe', 'contabilidade')
  )
$$;


-- ── 2. RH define a senha padrão ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION rh_definir_senha_padrao(p_pin text, p_aplicar_a_todos boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_senha   text := btrim(coalesce(p_pin, ''));
  v_apagadas int := 0;
BEGIN
  IF NOT rh_eh_chefe() THEN
    RAISE EXCEPTION 'Só o chefe pode definir a senha padrão do portal' USING ERRCODE = '42501';
  END IF;
  IF octet_length(v_senha) NOT BETWEEN 6 AND 72 THEN
    RAISE EXCEPTION 'A senha precisa ter entre 6 e 72 caracteres';
  END IF;

  INSERT INTO app_private.portal_config (id, default_pin_hash, updated_at, updated_by)
  VALUES (true, crypt(v_senha, gen_salt('bf', 12)), now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET default_pin_hash = EXCLUDED.default_pin_hash,
        updated_at       = EXCLUDED.updated_at,
        updated_by       = EXCLUDED.updated_by;

  IF p_aplicar_a_todos THEN
    -- Todo mundo passa a usar a padrão
    DELETE FROM app_private.portal_credentials WHERE true;
    GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  END IF;

  -- Senha trocada: derruba as sessões abertas e destrava quem errou 5 vezes
  DELETE FROM portal_sessions WHERE true;
  DELETE FROM portal_login_attempts WHERE true;

  RETURN jsonb_build_object('senhas_proprias_removidas', v_apagadas);
END$$;

GRANT EXECUTE ON FUNCTION rh_definir_senha_padrao(text, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION rh_definir_senha_padrao(text, boolean) FROM anon, public;


-- ── 3. Situação da senha padrão (para a tela de Usuários) ────────────────
CREATE OR REPLACE FUNCTION rh_senha_padrao_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_cfg app_private.portal_config;
BEGIN
  IF NOT rh_eh_chefe() THEN RETURN NULL; END IF;
  SELECT * INTO v_cfg FROM app_private.portal_config WHERE id;
  RETURN jsonb_build_object(
    'definida', v_cfg.default_pin_hash IS NOT NULL,
    'atualizada_em', v_cfg.updated_at,
    'com_senha_propria', (SELECT count(*) FROM app_private.portal_credentials WHERE pin_hash IS NOT NULL)
  );
END$$;

GRANT EXECUTE ON FUNCTION rh_senha_padrao_status() TO authenticated;
REVOKE EXECUTE ON FUNCTION rh_senha_padrao_status() FROM anon, public;


-- ── 4. Ficha > Portal: essa pessoa usa senha própria ou a padrão? ────────
CREATE OR REPLACE FUNCTION portal_tipo_senha(p_employee uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM app_private.portal_credentials WHERE employee_id = p_employee AND pin_hash IS NOT NULL) THEN
    RETURN 'propria';
  END IF;
  IF EXISTS (SELECT 1 FROM app_private.portal_config WHERE id AND default_pin_hash IS NOT NULL) THEN
    RETURN 'padrao';
  END IF;
  RETURN 'nenhuma';
END$$;

GRANT EXECUTE ON FUNCTION portal_tipo_senha(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_tipo_senha(uuid) FROM anon, public;


-- ── 5. Ficha > Portal: voltar uma pessoa para a senha padrão ─────────────
CREATE OR REPLACE FUNCTION portal_usar_senha_padrao(p_employee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_cpf text;
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Apenas usuários internos' USING ERRCODE = '42501';
  END IF;
  DELETE FROM app_private.portal_credentials WHERE employee_id = p_employee;
  DELETE FROM portal_sessions WHERE employee_id = p_employee;
  SELECT regexp_replace(coalesce(cpf, ''), '\D', '', 'g') INTO v_cpf FROM employees WHERE id = p_employee;
  IF v_cpf IS NOT NULL AND v_cpf <> '' THEN
    DELETE FROM portal_login_attempts WHERE cpf_digits = v_cpf;
  END IF;
END$$;

GRANT EXECUTE ON FUNCTION portal_usar_senha_padrao(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_usar_senha_padrao(uuid) FROM anon, public;


-- ── 6. "Tem senha?" passa a considerar a padrão ──────────────────────────
CREATE OR REPLACE FUNCTION portal_has_pin(p_employee uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM app_private.portal_credentials
     WHERE employee_id = p_employee AND pin_hash IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM app_private.portal_config WHERE id AND default_pin_hash IS NOT NULL
  );
END$$;


-- ── 7. Login: senha própria; se não tiver, a padrão ──────────────────────
-- Igual ao da 050 (bloqueio por tentativas, trava de contrato), só muda a
-- origem do hash.
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

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA
-- ============================================================
SELECT 'senha padrão definida?' AS item,
       CASE WHEN EXISTS (SELECT 1 FROM app_private.portal_config WHERE id AND default_pin_hash IS NOT NULL)
            THEN 'sim' ELSE 'ainda não — defina em Usuários' END AS valor
UNION ALL
SELECT 'pessoas com senha própria', count(*)::text FROM app_private.portal_credentials WHERE pin_hash IS NOT NULL;
