-- ============================================================
-- 097 — Consultor fixo: horas por semana do CONTRATO (pedido de 17/10/2026)
-- "Esse contrato ela precisa ter 40 horas semanais. Dessas 40, posso colocar
--  5 no cliente X, 10 no cliente Y... ou deixar em aberto e ela vê para qual
--  cliente vai."
--   • employee_client_links.contrato_horas_semana — o total do contrato
--     (fica no vínculo principal do consultor fixo, o que guarda o salário).
--   • A divisão por cliente usa employee_client_links.horas_semana (091) de
--     cada cliente; vazio = em aberto.
-- Só acrescenta coluna. Não muda salário nem pagamento. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE employee_client_links ADD COLUMN IF NOT EXISTS contrato_horas_semana numeric(5,1)
  CHECK (contrato_horas_semana IS NULL OR contrato_horas_semana > 0);
COMMENT ON COLUMN employee_client_links.contrato_horas_semana IS
  'Consultor fixo: total de horas por semana do contrato (no vínculo principal). A divisão por cliente fica em horas_semana; vazio = em aberto.';

NOTIFY pgrst, 'reload schema';

-- Conferir: coluna = 1
SELECT count(*) AS coluna FROM information_schema.columns
 WHERE table_name = 'employee_client_links' AND column_name = 'contrato_horas_semana';
