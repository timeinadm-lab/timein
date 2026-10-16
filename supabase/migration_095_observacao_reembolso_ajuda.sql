-- ============================================================
-- 095 — Observação do RH no reembolso e na ajuda de custo (pedido de 16/10/2026)
-- "Seria bom eu colocar observações também."
--   • employee_expenses.obs_rh  — observação do RH no reembolso/gasto
--     (notes continua sendo o que a colaboradora escreveu no portal)
--   • ajudas_custo.observacao   — observação na ajuda de custo
-- Só acrescenta colunas. Não muda valor, pagamento nem o gatilho do reembolso
-- (mudar a observação não mexe no que já está na Ajuda de custo).
-- Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE employee_expenses ADD COLUMN IF NOT EXISTS obs_rh text;
ALTER TABLE ajudas_custo ADD COLUMN IF NOT EXISTS observacao text;

COMMENT ON COLUMN employee_expenses.obs_rh IS 'Observação do RH (a colaboradora escreve em notes, pelo portal).';
COMMENT ON COLUMN ajudas_custo.observacao IS 'Observação do RH na ajuda de custo.';

NOTIFY pgrst, 'reload schema';

-- Conferir: tem que dar 2
SELECT count(*) AS colunas FROM information_schema.columns
 WHERE (table_name = 'employee_expenses' AND column_name = 'obs_rh')
    OR (table_name = 'ajudas_custo' AND column_name = 'observacao');
