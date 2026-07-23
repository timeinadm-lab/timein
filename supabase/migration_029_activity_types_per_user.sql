-- =====================================================================
-- migration_029_activity_types_per_user.sql
-- A lista pré-cadastrada de atividades passa a ser POR USUÁRIO
-- (cada login tem a sua). Execute no Supabase SQL Editor.
-- =====================================================================

ALTER TABLE activity_types
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
