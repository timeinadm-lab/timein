-- ============================================================
-- Migration 077 — Só a equipe liberada entra nos dados
-- ------------------------------------------------------------
-- O buraco: o cadastro público do Supabase está aberto (a tela Usuários
-- criava conta com signUp). A chave pública fica no site, então qualquer
-- pessoa podia criar uma conta sozinha — e todas as tabelas liberavam tudo
-- para "qualquer um logado": CPF, salário, PIX, documentos. E qualquer
-- logado podia trocar o próprio papel para chefe.
--
-- O que esta migração faz (não apaga nem muda nenhum dado):
--  1. user_profiles ganha "acesso_liberado". Quem já existe fica LIBERADO
--     (ninguém da equipe perde acesso). Conta nova nasce BLOQUEADA.
--  2. Segunda trava em TODAS as tabelas e nos arquivos: só lê/grava quem
--     está liberado. Conta bloqueada não vê nada.
--  3. Papel e liberação só a chefia (chefe/contabilidade) muda.
--  O portal das nutricionistas NÃO muda (ele usa outro caminho, com token).
--
-- Desfazer, se precisar: DESFAZER_077.sql
-- Pode rodar mais de uma vez.
-- ============================================================

-- ── 1. Liberação ─────────────────────────────────────────────────────────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS acesso_liberado boolean NOT NULL DEFAULT true; -- quem já existe: liberado
ALTER TABLE user_profiles ALTER COLUMN acesso_liberado SET DEFAULT false;                        -- conta nova: bloqueada

CREATE OR REPLACE FUNCTION eh_da_equipe() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND acesso_liberado)
$$;
REVOKE ALL ON FUNCTION eh_da_equipe() FROM public, anon;
GRANT EXECUTE ON FUNCTION eh_da_equipe() TO authenticated;

-- Chefia = chefe ou contabilidade, e liberada
CREATE OR REPLACE FUNCTION eh_chefia() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('chefe', 'contabilidade') AND acesso_liberado)
$$;
REVOKE ALL ON FUNCTION eh_chefia() FROM public, anon;
GRANT EXECUTE ON FUNCTION eh_chefia() TO authenticated;

-- ── 2. Papel e liberação: só a chefia muda ──────────────────────────────
CREATE OR REPLACE FUNCTION proteger_perfil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sem usuário do app (SQL Editor, criação de conta pelo Supabase): segue
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT eh_chefia() THEN NEW.role := 'recrutador'; NEW.acesso_liberado := false; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.acesso_liberado IS DISTINCT FROM OLD.acesso_liberado)
     AND NOT eh_chefia() THEN
    RAISE EXCEPTION 'Só a chefia muda papel ou liberação de acesso.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_proteger_perfil ON user_profiles;
CREATE TRIGGER trg_proteger_perfil BEFORE INSERT OR UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION proteger_perfil();

-- ── 3. Segunda trava em todas as tabelas (RESTRICTIVE: soma às regras de hoje) ──
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND rowsecurity AND tablename <> 'user_profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS so_equipe ON public.%I', t.tablename);
    EXECUTE format('CREATE POLICY so_equipe ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
                      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()))', t.tablename);
  END LOOP;
END$$;

-- Perfil: cada um lê o próprio (para a tela mostrar "aguardando liberação"); o resto, só liberado
DROP POLICY IF EXISTS so_equipe_ler ON user_profiles;
DROP POLICY IF EXISTS so_equipe_incluir ON user_profiles;
DROP POLICY IF EXISTS so_equipe_alterar ON user_profiles;
DROP POLICY IF EXISTS so_equipe_apagar ON user_profiles;
CREATE POLICY so_equipe_ler ON user_profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id = auth.uid() OR (SELECT eh_da_equipe()));
CREATE POLICY so_equipe_incluir ON user_profiles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT eh_da_equipe()));
CREATE POLICY so_equipe_alterar ON user_profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
CREATE POLICY so_equipe_apagar ON user_profiles AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT eh_da_equipe()));

-- Arquivos (documentos, contratos, comprovantes): conta bloqueada não abre nada.
-- O envio do portal é pela chave pública (anon) e não é afetado.
DROP POLICY IF EXISTS so_equipe ON storage.objects;
CREATE POLICY so_equipe ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));

NOTIFY pgrst, 'reload schema';

-- ── Conferência: todas as contas com acesso ao sistema ───────────────────
-- Olhe a lista. Se aparecer alguém que você NÃO conhece, bloqueie em Usuários
-- (ou: UPDATE user_profiles SET acesso_liberado = false WHERE email = '...').
SELECT p.full_name AS nome, u.email, p.role AS papel,
       CASE WHEN p.id IS NULL THEN 'SEM PERFIL' WHEN p.acesso_liberado THEN 'liberado' ELSE 'BLOQUEADO' END AS acesso,
       to_char(u.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS criada_em,
       to_char(u.last_sign_in_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ultimo_login
  FROM auth.users u LEFT JOIN user_profiles p ON p.id = u.id
 ORDER BY u.created_at;
