-- ============================================================
-- Migration 104 — Auditoria GR: cobranças e envio do resultado
-- ------------------------------------------------------------
-- Pedido da cliente (22/10/2026), sobre o relatório:
-- - "eles demoram pra responder, eu acabo cobrando... um chequezinho na
--   cobrança, constar a data": lista de cobranças, cada uma com data e uma
--   observação curta (quantas quiser);
-- - "quando que eu mandei o resultado da auditoria": data do envio.
-- A próxima auditoria (validade) continua na coluna que já existe; o sistema
-- só sugere a data pelo resultado (aprovado 2 anos, com ressalvas 6 meses).
-- Precisa da 087. Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS cobrancas jsonb NOT NULL DEFAULT '[]'::jsonb;  -- [{ data, obs }]
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS resultado_enviado_em date;

NOTIFY pgrst, 'reload schema';

-- Conferência (esperado: 2)
SELECT count(*) AS colunas_novas FROM information_schema.columns
 WHERE table_name = 'auditorias_fornecedores' AND column_name IN ('cobrancas', 'resultado_enviado_em');
