-- ============================================================
-- 094 — Observações do colaborador (pedido de 15/10/2026)
-- "Atualizar tal coisa no contrato dela", "metade o cliente paga, metade a
-- gente paga"… Ficam salvas até o RH apagar. As marcadas como destaque
-- aparecem numa faixa no topo do colaborador. Saem no PDF e no Excel.
-- Pode rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_observacoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  texto       text NOT NULL CHECK (length(trim(texto)) > 0),
  destaque    boolean NOT NULL DEFAULT true,
  criado_por  text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_observacoes_emp ON employee_observacoes (employee_id, criado_em DESC);

ALTER TABLE employee_observacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipe_usa ON employee_observacoes;
CREATE POLICY equipe_usa ON employee_observacoes FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON employee_observacoes;
    CREATE POLICY so_equipe ON employee_observacoes AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência (esperado: t · 2)
SELECT c.relrowsecurity AS rls_ligada,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'employee_observacoes') AS politicas
FROM pg_class c WHERE c.relname = 'employee_observacoes';
