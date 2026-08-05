-- ============================================================
-- Migration 032 — corrige a constraint de service_type
-- ------------------------------------------------------------
-- O cadastro de freela (avulso) grava service_type = 'Volante',
-- e vínculos fixos gravam 'Fixo'. A constraint original só aceitava
-- ('PJ','Consultoria'), então qualquer freela quebrava com:
--   violates check constraint "employee_client_links_service_type_check"
-- Aqui liberamos todos os valores que o sistema usa.
-- ============================================================

ALTER TABLE employee_client_links
  DROP CONSTRAINT IF EXISTS employee_client_links_service_type_check;

ALTER TABLE employee_client_links
  ADD CONSTRAINT employee_client_links_service_type_check
  CHECK (service_type IN ('PJ', 'Consultoria', 'Fixo', 'Volante', 'Ambos'));

NOTIFY pgrst, 'reload schema';
