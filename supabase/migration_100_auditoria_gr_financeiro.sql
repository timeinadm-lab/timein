-- ============================================================
-- Migration 100 — Auditoria GR: financeiro + status novos
-- ------------------------------------------------------------
-- Pedido do Gabriel (20/10/2026), aprovado pela chefe: a planilha de
-- auditorias de fornecedores da GRSA (087) vira "Auditoria GR" em Planilhas,
-- planilha/relatório para controle e para apresentar ao cliente.
--
--   · Status novos da planilha de 07/10: Em elaboração de orçamento,
--     Aguardando pagamento, Aguardando comprovante, Aguardando relatório.
--   · Pagamento simplificado: Não pago / Aguardando comprovante / Pago /
--     Não se aplica.
--   · Bloco Financeiro: local da auditoria, forma de pagamento (Pix na conta
--     da empresa, boleto…), se precisa de nota fiscal (nº e data), comprovante
--     anexado e observação financeira. "Quem paga" continua sendo
--     responsavel_pagamento (Unidade GRSA / Fornecedor).
-- Não apaga nenhum dado. Pode rodar mais de uma vez.
-- ============================================================

-- ── 1. Colunas novas (financeiro) ────────────────────────────────────────
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS local_auditoria text;
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS forma_pagamento text;
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS precisa_nota    boolean;   -- vazio = ainda não informado
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS nota_numero     text;
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS nota_emitida_em date;
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS comprovante_url text;      -- caminho no bucket "arquivos"
ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS obs_financeiro  text;

-- ── 2. Tira as regras antigas de status/pagamento ────────────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'auditorias_fornecedores'::regclass AND contype = 'c' LOOP
    IF c.def ILIKE '%status%' OR c.def ILIKE '%pagamento%' THEN
      EXECUTE format('ALTER TABLE auditorias_fornecedores DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END$$;

-- ── 3. Pagamento antigo → novo ───────────────────────────────────────────
UPDATE auditorias_fornecedores SET pagamento = 'Não pago' WHERE pagamento IN ('Não confirmado', 'Não pago');
UPDATE auditorias_fornecedores SET pagamento = 'Pago', comprovante_enviado = true
 WHERE pagamento IN ('Informado – comprovante enviado', 'Confirmado pelo financeiro');
UPDATE auditorias_fornecedores SET pagamento = 'Não se aplica' WHERE pagamento = 'Não aplicável';
ALTER TABLE auditorias_fornecedores ALTER COLUMN pagamento SET DEFAULT 'Não pago';
ALTER TABLE auditorias_fornecedores ALTER COLUMN status SET DEFAULT 'Em elaboração de orçamento';

-- ── 4. Regras novas ──────────────────────────────────────────────────────
ALTER TABLE auditorias_fornecedores ADD CONSTRAINT aud_forn_status_ok CHECK (status IN (
  'Em elaboração de orçamento', 'Aguardando aprovação', 'Aguardando retorno do fornecedor',
  'Aguardando definição de laboratório', 'Aguardando pagamento', 'Aguardando comprovante',
  'Agendada', 'Aguardando relatório', 'Concluída',
  'Cancelada', 'Encerrada – outro prestador', 'Encerrada – auditoria vigente'));
ALTER TABLE auditorias_fornecedores ADD CONSTRAINT aud_forn_pagamento_ok
  CHECK (pagamento IN ('Não pago', 'Aguardando comprovante', 'Pago', 'Não se aplica'));
ALTER TABLE auditorias_fornecedores ADD CONSTRAINT aud_forn_forma_ok
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('Pix na conta da empresa', 'Boleto', 'Transferência', 'Faturado na GR'));

NOTIFY pgrst, 'reload schema';

-- Conferência: as 7 colunas novas (esperado: 7)
SELECT count(*) AS colunas_novas FROM information_schema.columns
 WHERE table_name = 'auditorias_fornecedores'
   AND column_name IN ('local_auditoria', 'forma_pagamento', 'precisa_nota', 'nota_numero', 'nota_emitida_em', 'comprovante_url', 'obs_financeiro');
