-- =====================================================================
-- migration_027_admin_activities.sql
-- Atividades do Administrativo: lista de tipos (editável pelo time) +
-- registro diário de atividades por pessoa, com observação.
-- Execute no Supabase SQL Editor
-- =====================================================================

-- 1. Lista de tipos de atividade (começa vazia; o time cria/exclui)
CREATE TABLE IF NOT EXISTS activity_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_activity_types" ON activity_types;
CREATE POLICY "auth_all_activity_types" ON activity_types FOR ALL USING (auth.role() = 'authenticated');

-- 2. Registros de atividade (uma linha por atividade feita no dia)
--    activity_name é um SNAPSHOT do nome — se o tipo for excluído da lista,
--    o histórico não se perde.
CREATE TABLE IF NOT EXISTS activity_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  activity_name TEXT NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_activity_logs" ON activity_logs;
CREATE POLICY "auth_all_activity_logs" ON activity_logs FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_date ON activity_logs (user_id, activity_date);

NOTIFY pgrst, 'reload schema';
