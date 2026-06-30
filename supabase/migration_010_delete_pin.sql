-- ============================================================================
-- MIGRATION 010 — PIN DE EXCLUSÃO
-- Apagar vaga, colaborador ou cliente passa a exigir um PIN.
-- Só quem tem perfil 'chefe' define o PIN (em Usuários). Qualquer usuário
-- interno valida o PIN antes de apagar. O PIN é guardado só como hash.
-- Rode inteiro no SQL Editor do Supabase. Idempotente. Requer a 008 (auth_is_chefe).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Singleton: uma linha só guarda o hash do PIN de exclusão
CREATE TABLE IF NOT EXISTS app_security (
  id              int PRIMARY KEY DEFAULT 1,
  delete_pin_hash text,
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT app_security_singleton CHECK (id = 1)
);
ALTER TABLE app_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_security FROM anon;
-- Ninguém lê/escreve direto: tudo pelas funções SECURITY DEFINER abaixo.

-- Chefe define ou troca o PIN
CREATE OR REPLACE FUNCTION set_delete_pin(p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT auth_is_chefe() THEN
    RAISE EXCEPTION 'Apenas o chefe pode definir o PIN de exclusão' USING ERRCODE='42501';
  END IF;
  IF length(coalesce(p_pin,'')) < 4 THEN
    RAISE EXCEPTION 'O PIN precisa de pelo menos 4 dígitos';
  END IF;
  INSERT INTO app_security (id, delete_pin_hash, updated_at)
    VALUES (1, crypt(p_pin, gen_salt('bf')), now())
  ON CONFLICT (id) DO UPDATE SET delete_pin_hash = EXCLUDED.delete_pin_hash, updated_at = now();
END$$;
GRANT EXECUTE ON FUNCTION set_delete_pin(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION set_delete_pin(text) FROM anon, public;

-- Qualquer usuário interno valida o PIN antes de apagar (true = liberado)
CREATE OR REPLACE FUNCTION verify_delete_pin(p_pin text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_hash text;
BEGIN
  IF auth.role() <> 'authenticated' THEN RETURN false; END IF;
  SELECT delete_pin_hash INTO v_hash FROM app_security WHERE id = 1;
  IF v_hash IS NULL THEN RETURN false; END IF;
  RETURN crypt(p_pin, v_hash) = v_hash;
END$$;
GRANT EXECUTE ON FUNCTION verify_delete_pin(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION verify_delete_pin(text) FROM anon, public;

-- Saber se já existe PIN configurado (a tela orienta o chefe a criar)
CREATE OR REPLACE FUNCTION has_delete_pin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_security WHERE id = 1 AND delete_pin_hash IS NOT NULL);
$$;
GRANT EXECUTE ON FUNCTION has_delete_pin() TO authenticated;

-- ============================================================================
-- Pronto. Próximo passo no app: o chefe define o PIN em Usuários, e os botões
-- de excluir vaga/colaborador/cliente passam a pedir esse PIN.
-- ============================================================================
