-- ============================================================
-- Migration 113 — Registro dos erros que aparecem na tela
-- ------------------------------------------------------------
-- Pedido do Gabriel (20/11/2026): "a página ainda apresenta muito bug, tipo
-- 'tenta de novo', 'recarregar página'". Quem conserta não vê a tela dele.
-- Esta tabela guarda a mensagem do erro, a tela e a hora, para o conserto não
-- depender de print. Não guarda dado de colaborador nem de pagamento.
-- Só a equipe logada grava e lê. Não mexe em nada existente. Pode rodar de novo.
-- ============================================================

CREATE TABLE IF NOT EXISTS erros_de_tela (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quando     timestamptz NOT NULL DEFAULT now(),
  user_id    uuid DEFAULT auth.uid(),
  rota       text,
  onde       text,
  mensagem   text NOT NULL,
  pilha      text,
  navegador  text,
  largura    integer
);
CREATE INDEX IF NOT EXISTS erros_de_tela_quando ON erros_de_tela (quando DESC);

ALTER TABLE erros_de_tela ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "erros_gravar" ON erros_de_tela;
DROP POLICY IF EXISTS "erros_ler" ON erros_de_tela;
CREATE POLICY "erros_gravar" ON erros_de_tela FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "erros_ler"    ON erros_de_tela FOR SELECT TO authenticated USING (true);

-- Trava da 077: só equipe liberada
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON erros_de_tela;
    CREATE POLICY so_equipe ON erros_de_tela AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS deve_dar_1 FROM information_schema.tables WHERE table_name = 'erros_de_tela';
