-- ============================================================
-- Migration 073 — Histórico da Jornada + lançamento ajustado à mão
-- ------------------------------------------------------------
-- Pedido do Gabriel (01/10/2026):
--   1. A Jornada de cada colaborador gera um PDF do mês que fica SALVO no
--      histórico (quem salvou, quando, os números daquele momento).
--   2. Vínculo e salário podem ser editados a qualquer hora e o pagamento
--      ainda não pago tem que acompanhar o valor novo. O sistema passa a
--      atualizar sozinho o lançamento PENDENTE — menos o que o RH ajustou
--      à mão ("Ajustar lançamento"), que fica marcado e não é mexido.
-- Não altera nenhum valor existente. Pode rodar mais de uma vez.
-- ============================================================

-- ── 1. Histórico da Jornada ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jornada_historico (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  mes         text NOT NULL CHECK (mes ~ '^\d{4}-\d{2}$'),   -- yyyy-MM
  arquivo     text NOT NULL,                                 -- caminho no armazenamento (pasta 'arquivos')
  resumo      jsonb,                                         -- números do mês no momento em que foi salvo
  criado_por  uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jornada_historico_pessoa_mes ON jornada_historico (employee_id, mes);

ALTER TABLE jornada_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rh_jornada_historico" ON jornada_historico;
CREATE POLICY "rh_jornada_historico" ON jornada_historico FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── 2. Lançamento ajustado à mão ─────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ajuste_manual boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 2
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'jornada_historico')
     + (SELECT count(*) FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'ajuste_manual')
     AS deve_dar_2;
