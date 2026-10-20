-- ============================================================
-- Migration 102 — Auditoria GR: documentos do processo (anexos)
-- ------------------------------------------------------------
-- Pedido do Gabriel (20/10/2026): acompanhar o que vai sendo coletado em
-- cada auditoria — orçamento, aprovação do comprador, comprovante de
-- pagamento, nota fiscal, agendamento, relatório da auditoria e pagamento ao
-- auditor —, com quantos arquivos quiser em cada um e uma observação embaixo.
-- Lista em jsonb: [{ caminho, nome, tipo, obs, em }] (tipo = qual documento);
-- o arquivo fica no bucket "arquivos" (auditoria-gr/<ID>/...).
-- O comprovante único da 100 (comprovante_url) vira o primeiro anexo.
-- Precisa da 100. Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS anexos jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE auditorias_fornecedores
   SET anexos = jsonb_build_array(jsonb_build_object(
         'caminho', comprovante_url, 'nome', 'Comprovante', 'tipo', 'comprovante', 'obs', NULL,
         'em', coalesce(comprovante_recebido_em::text, to_char(now(), 'YYYY-MM-DD'))))
 WHERE comprovante_url IS NOT NULL AND anexos = '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

-- Conferência (esperado: 1)
SELECT count(*) AS coluna_anexos FROM information_schema.columns
 WHERE table_name = 'auditorias_fornecedores' AND column_name = 'anexos';
