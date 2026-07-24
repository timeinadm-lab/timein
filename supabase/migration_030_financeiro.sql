-- =====================================================================
-- migration_030_financeiro.sql
-- Cargo "contabilidade" (acesso total + Financeiro) e lançamentos
-- financeiros (entradas/saídas fora da folha) com recorrência.
-- Execute no Supabase SQL Editor.
-- =====================================================================

-- 1. Novo papel: contabilidade
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('chefe', 'recrutador', 'contabilidade'));

-- 2. Lançamentos financeiros (entrada = dinheiro que entra, saida = despesa fora da folha)
CREATE TABLE IF NOT EXISTS financial_entries (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind              text NOT NULL CHECK (kind IN ('entrada', 'saida')),
  description       text NOT NULL,
  amount            numeric(12,2) NOT NULL,
  category          text,
  client_id         uuid REFERENCES clients(id) ON DELETE SET NULL,
  entry_date        date NOT NULL,   -- data do lançamento (e início, se recorrente)
  recurrence        text NOT NULL DEFAULT 'unica' CHECK (recurrence IN ('unica', 'mensal', 'ate_data')),
  recurrence_until  date,            -- usado quando recurrence = 'ate_data'
  created_by        uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT NOW()
);

-- 3. Sigilo: SÓ o contabilidade acessa os lançamentos financeiros (nível banco)
ALTER TABLE financial_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contabilidade_only_financial" ON financial_entries;
CREATE POLICY "contabilidade_only_financial" ON financial_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'contabilidade'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'contabilidade'));

CREATE INDEX IF NOT EXISTS idx_financial_entries_date ON financial_entries (entry_date);

NOTIFY pgrst, 'reload schema';
