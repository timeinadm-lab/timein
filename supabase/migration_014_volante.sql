-- =====================================================================
-- migration_014_volante.sql
-- Tipo de colaborador Volante: cobertura temporária sem contrato fixo
-- Execute no Supabase SQL Editor
-- =====================================================================

-- 1. Tipo de colaborador (Regular ou Volante)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_type TEXT NOT NULL DEFAULT 'Regular'
    CHECK (employee_type IN ('Regular', 'Volante'));

-- 2. Diária no vínculo (usado pelo Volante; Regular usa monthly_amount ÷ divisor)
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS daily_rate NUMERIC(10,2);

NOTIFY pgrst, 'reload schema';
