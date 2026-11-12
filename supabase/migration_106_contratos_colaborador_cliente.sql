-- ============================================================
-- Migration 106 — Contrato ligado ao colaborador, ao cliente e ao vínculo
-- ------------------------------------------------------------
-- A tela /contratos gravava employee_id e client_id, mas a tabela contracts
-- não tem essas colunas (só client_name em texto). O insert falhava e a
-- tabela ficava vazia. O mesmo insert acontece ao contratar pela vaga.
--
-- Esta migração só ACRESCENTA colunas. Não apaga e não altera linha nenhuma.
-- Pode rodar mais de uma vez.
--
-- Não mexe em client_contracts. A política so_equipe dessa tabela
-- (authenticated + eh_da_equipe()) continua valendo; o app lê e grava com o
-- usuário logado da equipe, então a ficha do cliente segue funcionando.
-- As políticas que já existem em contracts (auth_all_contracts + so_equipe)
-- passam a cobrir as colunas novas — não cria política nova.
--
-- Depois de rodar: NOTIFY pgrst recarrega o cache da API.
-- ============================================================

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_id     uuid REFERENCES employee_client_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content     text,
  ADD COLUMN IF NOT EXISTS file_url    text;

CREATE INDEX IF NOT EXISTS contracts_employee_id_idx ON contracts (employee_id);
CREATE INDEX IF NOT EXISTS contracts_client_id_idx   ON contracts (client_id);
CREATE INDEX IF NOT EXISTS contracts_link_id_idx     ON contracts (link_id);

NOTIFY pgrst, 'reload schema';
