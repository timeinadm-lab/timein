-- =====================================================================
-- migration_031_financeiro_vaga.sql
-- Receita ligada à vaga + confirmação mensal (check-in de "entrou mesmo").
-- Execute no Supabase SQL Editor. Requer a migration_030.
-- =====================================================================

-- 1. Entrada pode estar ligada a uma vaga (o que a empresa recebe por ela)
ALTER TABLE financial_entries
  ADD COLUMN IF NOT EXISTS vacancy_id uuid REFERENCES vacancies(id) ON DELETE SET NULL;

-- 2. Confirmação mensal: o Financeiro marca "entrou mesmo" (check-in) por mês.
--    Uma linha por (lançamento, mês). Sem linha = ainda não confirmado.
CREATE TABLE IF NOT EXISTS financial_confirmations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id     uuid NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  month        text NOT NULL,               -- 'yyyy-MM'
  received     boolean NOT NULL DEFAULT true,
  received_at  timestamptz DEFAULT NOW(),
  UNIQUE (entry_id, month)
);

ALTER TABLE financial_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contabilidade_only_confirmations" ON financial_confirmations;
CREATE POLICY "contabilidade_only_confirmations" ON financial_confirmations FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'contabilidade'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'contabilidade'));

NOTIFY pgrst, 'reload schema';
