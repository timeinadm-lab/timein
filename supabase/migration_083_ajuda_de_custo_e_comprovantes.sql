-- ============================================================
-- Migration 083 — Ajuda de custo (semanal ou mensal) e comprovantes
-- ------------------------------------------------------------
-- Pedido de 05/10/2026: a planilha de custos do projeto que vai para o
-- Wilson (Airbnb, aluguel de carro, combustível, alimentação…) passa a ficar
-- no sistema, em Pagamentos → Ajuda de custo. Cada lançamento é de um
-- colaborador num cliente, numa semana ou no mês. Tem controle próprio de
-- pago + comprovante (NÃO entra na conta da folha, para não pagar em dobro).
-- E todo pagamento pode guardar o comprovante (Pagamentos → Comprovantes).
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS ajudas_custo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
  periodo         text NOT NULL DEFAULT 'semana' CHECK (periodo IN ('semana', 'mes')),
  inicio          date NOT NULL,          -- segunda-feira da semana, ou dia 1 do mês
  fim             date NOT NULL,
  tipo            text NOT NULL DEFAULT 'Outro',
  descricao       text,
  valor           numeric(10,2) NOT NULL CHECK (valor >= 0),
  status          text NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Pago')),
  pago_em         date,
  comprovante_url text,
  criado_por      uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ajudas_custo_periodo ON ajudas_custo (inicio, fim);
CREATE INDEX IF NOT EXISTS ajudas_custo_pessoa ON ajudas_custo (employee_id, inicio);

ALTER TABLE ajudas_custo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipe_usa ON ajudas_custo;
CREATE POLICY equipe_usa ON ajudas_custo FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Trava da 077 (só equipe liberada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON ajudas_custo;
    CREATE POLICY so_equipe ON ajudas_custo AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

-- Comprovante de qualquer pagamento
ALTER TABLE payments ADD COLUMN IF NOT EXISTS comprovante_url text;

NOTIFY pgrst, 'reload schema';

-- Conferência
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'ajudas_custo') AS tabela_ajuda_custo,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'comprovante_url') AS coluna_comprovante;
