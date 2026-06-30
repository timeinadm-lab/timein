-- =====================================================================
-- migration_013_chat_admin_message.sql
-- Permite que o admin inicie conversa com o colaborador via Chat
-- Execute no Supabase SQL Editor
-- =====================================================================

-- 1. Campo para identificar mensagens iniciadas pelo admin
ALTER TABLE employee_questions
  ADD COLUMN IF NOT EXISTS initiated_by_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Permite que message seja nulo (para mensagens iniciadas pelo admin)
ALTER TABLE employee_questions
  ALTER COLUMN message DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
