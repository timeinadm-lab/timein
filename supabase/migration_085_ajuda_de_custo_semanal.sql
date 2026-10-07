-- ============================================================
-- Migration 085 — Ajuda de custo do contrato: semanal ou mensal
-- ------------------------------------------------------------
-- Pedido de 07/10/2026: a ajuda de custo do consultor fixo pode ser paga
-- toda segunda-feira (semanal) em vez de junto com o salário (mensal).
-- • Mensal (padrão, como sempre foi): entra na folha junto com o salário.
-- • Semanal: SAI da folha e vira um lançamento por semana em
--   Pagamentos → Ajuda de custo (para marcar pago toda segunda).
-- ajudas_custo.link_id liga o lançamento semanal ao contrato, para não
-- duplicar a semana. Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS cost_assistance_periodo text NOT NULL DEFAULT 'mes';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'links_ajuda_periodo_ok') THEN
    ALTER TABLE employee_client_links
      ADD CONSTRAINT links_ajuda_periodo_ok CHECK (cost_assistance_periodo IN ('mes', 'semana'));
  END IF;
END$$;

ALTER TABLE ajudas_custo
  ADD COLUMN IF NOT EXISTS link_id uuid REFERENCES employee_client_links(id) ON DELETE SET NULL;
-- Uma linha por contrato por semana
CREATE UNIQUE INDEX IF NOT EXISTS ajudas_custo_contrato_semana ON ajudas_custo (link_id, inicio);

NOTIFY pgrst, 'reload schema';

-- Conferência
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'employee_client_links' AND column_name = 'cost_assistance_periodo') AS coluna_periodo,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'ajudas_custo' AND column_name = 'link_id') AS coluna_link,
       (SELECT count(*) FROM employee_client_links WHERE cost_assistance_periodo = 'semana') AS contratos_semanais;
