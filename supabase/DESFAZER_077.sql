-- Desfaz a 077 (só use se algo parar de funcionar depois dela). Não apaga dados.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'so_equipe'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS so_equipe ON public.%I', t.tablename);
  END LOOP;
END$$;
DROP POLICY IF EXISTS so_equipe_ler ON user_profiles;
DROP POLICY IF EXISTS so_equipe_incluir ON user_profiles;
DROP POLICY IF EXISTS so_equipe_alterar ON user_profiles;
DROP POLICY IF EXISTS so_equipe_apagar ON user_profiles;
DROP POLICY IF EXISTS so_equipe ON storage.objects;
DROP TRIGGER IF EXISTS trg_proteger_perfil ON user_profiles;
NOTIFY pgrst, 'reload schema';
