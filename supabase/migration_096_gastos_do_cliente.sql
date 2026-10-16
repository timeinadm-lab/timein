-- ============================================================
-- 096 — Gastos com o cliente (pedido de 16/10/2026)
-- "Escolher o cliente e anexar os gastos: Airbnb para os nossos funcionários,
--  o que precisou fazer... nome do gasto, observação, valor em reais e o
--  comprovante. Isso gera um PDF com a tabela e a foto do comprovante."
-- Tabela nova (não mexe em pagamento, folha nem ajuda de custo).
-- Pode rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS gastos_cliente (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  data            date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  nome            text NOT NULL,
  observacao      text,
  valor           numeric(12,2) NOT NULL CHECK (valor >= 0),
  employee_id     uuid REFERENCES employees(id) ON DELETE SET NULL,   -- para quem foi (opcional)
  comprovante_url text,
  criado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gastos_cliente_cliente_data ON gastos_cliente (client_id, data);

ALTER TABLE gastos_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipe_usa ON gastos_cliente;
CREATE POLICY equipe_usa ON gastos_cliente FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Trava da 077 (só equipe liberada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON gastos_cliente;
    CREATE POLICY so_equipe ON gastos_cliente AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferir: tabela = 1
SELECT count(*) AS tabela FROM information_schema.tables WHERE table_name = 'gastos_cliente';
