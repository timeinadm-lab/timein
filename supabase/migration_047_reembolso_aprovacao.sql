-- ============================================================
-- Migration 047 — Reembolso precisa ser analisado antes de pagar
-- ------------------------------------------------------------
-- O QUE ESTAVA ERRADO
-- O portal dizia à colaboradora "Gasto registrado! Aguardando aprovação do
-- gestor" — mas aprovação nenhuma existia. A tabela não tinha status, e a
-- folha somava TODO gasto do mês no pagamento, inclusive sem nota anexada.
-- Na prática: qualquer valor digitado no portal entrava no pagamento sozinho.
--
-- Agora todo reembolso nasce PENDENTE e só entra no pagamento depois que o
-- RH analisa, olhando a nota.
-- ============================================================

ALTER TABLE employee_expenses
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

-- Os gastos que já existiam entravam no pagamento sem análise nenhuma.
-- Marcá-los como aprovados mantém o passado exatamente como está — o
-- controle novo vale daqui pra frente, não muda pagamento já fechado.
UPDATE employee_expenses
   SET status = 'aprovado', reviewed_at = COALESCE(reviewed_at, created_at)
 WHERE status = 'pendente';

-- Daqui em diante o padrão é pendente
ALTER TABLE employee_expenses ALTER COLUMN status SET DEFAULT 'pendente';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_expenses_status_check') THEN
    ALTER TABLE employee_expenses
      ADD CONSTRAINT employee_expenses_status_check
      CHECK (status IN ('pendente', 'aprovado', 'negado'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_employee_expenses_status
  ON employee_expenses(reference_month, status);

NOTIFY pgrst, 'reload schema';

-- Conferência: como ficaram os gastos por mês
SELECT reference_month, status, count(*) AS qtd, sum(amount) AS total
  FROM employee_expenses
 GROUP BY reference_month, status
 ORDER BY reference_month DESC, status;
