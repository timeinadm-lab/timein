-- Prioridades manuais criadas no dashboard — visíveis para todos os usuários
CREATE TABLE IF NOT EXISTS custom_priorities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  text            TEXT NOT NULL,
  level           TEXT NOT NULL DEFAULT 'amber' CHECK (level IN ('red', 'amber')),
  created_by_name TEXT,
  resolved        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE custom_priorities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_custom_priorities" ON custom_priorities;
CREATE POLICY "auth_all_custom_priorities" ON custom_priorities
  FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_custom_priorities_open
  ON custom_priorities(resolved, created_at);

NOTIFY pgrst, 'reload schema';
