-- ============================================================
-- Migration 057 — Encerramento (rescisão) de vínculo com tudo registrado
-- ------------------------------------------------------------
-- Pedido da Bia (28/09/2026): "o cliente rompeu o contrato no meio. Temos que
-- encerrar e fazer um distrato — hoje não temos campo para rescisão."
--
-- Antes, "Encerrar" só gravava a data de fim = hoje. Agora o vínculo guarda
-- o encerramento completo. NADA é apagado: visitas, agenda, pagamentos e
-- documentos continuam ligados ao vínculo.
--
-- contract_end_date continua sendo o último dia (é o que a folha e o portal
-- já usam). As colunas novas só registram o porquê e o acerto.
-- ============================================================

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS ended_at              timestamptz,  -- quando o RH registrou o encerramento
  ADD COLUMN IF NOT EXISTS ended_by              uuid,         -- quem registrou (usuário do sistema)
  ADD COLUMN IF NOT EXISTS end_initiated_by      text,         -- quem encerrou: cliente | nutricionista | tin | acordo
  ADD COLUMN IF NOT EXISTS end_reason            text,         -- motivo
  ADD COLUMN IF NOT EXISTS end_document_url      text,         -- distrato assinado (arquivo no storage)
  ADD COLUMN IF NOT EXISTS end_fine_amount       numeric(12,2),-- multa/indenização (opcional)
  ADD COLUMN IF NOT EXISTS end_fine_description  text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecl_end_initiated_by_check') THEN
    ALTER TABLE employee_client_links
      ADD CONSTRAINT ecl_end_initiated_by_check
      CHECK (end_initiated_by IS NULL OR end_initiated_by IN ('cliente', 'nutricionista', 'tin', 'acordo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecl_end_fine_nonneg') THEN
    ALTER TABLE employee_client_links
      ADD CONSTRAINT ecl_end_fine_nonneg CHECK (end_fine_amount IS NULL OR end_fine_amount >= 0);
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência
SELECT count(*) FILTER (WHERE contract_end_date IS NOT NULL) AS vinculos_com_fim,
       count(*) FILTER (WHERE ended_at IS NOT NULL)          AS encerramentos_registrados
  FROM employee_client_links;
