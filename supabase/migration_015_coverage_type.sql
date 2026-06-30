-- =====================================================================
-- migration_015_coverage_type.sql
-- Tipo de cobertura (Fixo/Consultoria) no vínculo do Volante
-- Execute no Supabase SQL Editor
-- =====================================================================

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS coverage_type TEXT CHECK (coverage_type IN ('Fixo', 'Consultoria'));

NOTIFY pgrst, 'reload schema';
