-- =====================================================================
-- migration_028_activity_checklist.sql
-- Atividades viram checklist: cada item tem status "feito?" e pode ser
-- atribuído (ordem) por outra pessoa no dia de alguém do time.
-- Execute no Supabase SQL Editor
-- =====================================================================

ALTER TABLE activity_logs
  -- feito? NULL = pendente | TRUE = feito | FALSE = não feito
  ADD COLUMN IF NOT EXISTS done BOOLEAN,
  -- quem atribuiu (se diferente do dono do dia, é uma ordem/tarefa)
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
