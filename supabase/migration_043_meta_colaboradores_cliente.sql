-- ============================================================
-- Migration 043 — Meta de colaboradores por cliente
-- ------------------------------------------------------------
-- A vaga mede RECRUTAMENTO ("estou procurando gente"). Não mede COBERTURA
-- ("esse cliente está atendido"). Como agora dá pra vincular sem passar por
-- vaga, um cliente pode estar coberto sem vaga nenhuma — e descoberto com a
-- vaga marcada como preenchida.
--
-- Esta coluna é a meta de quantos colaboradores aquele cliente precisa ter
-- vinculados. A lista de Clientes usa isso pro sinal:
--   vermelho  = nenhum vinculado
--   amarelo   = tem, mas menos que a meta
--   verde     = meta atingida
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS target_employees INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN clients.target_employees IS
  'Quantos colaboradores este cliente precisa ter vinculados. Alimenta o sinal verde/amarelo/vermelho na lista de Clientes.';

NOTIFY pgrst, 'reload schema';
