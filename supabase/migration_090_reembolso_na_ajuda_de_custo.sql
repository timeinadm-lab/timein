-- 090 — Reembolso aprovado vai para a Ajuda de custo (decisão de 13/10/2026)
-- O reembolso que a pessoa pede no portal (Uber, ônibus…) ou que o RH lança,
-- quando APROVADO, vira uma linha na aba Pagamentos → Ajuda de custo, na
-- semana em que foi aprovado. É pago lá, junto com a ajuda semanal, e o RH
-- pode mudar o valor na tabela. Ele SAI do salário (a folha não soma reembolso
-- que já está na Ajuda de custo) — nunca é pago duas vezes.
-- Feito no banco (gatilho) para valer de qualquer lugar onde se aprove.
-- Reembolso aprovado ANTES desta migração continua no salário, como estava.
-- Pode rodar mais de uma vez.

ALTER TABLE ajudas_custo
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES employee_expenses(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ajudas_custo_expense ON ajudas_custo (expense_id);

CREATE OR REPLACE FUNCTION reembolso_para_ajuda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  seg date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;  -- segunda desta semana
  cli uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Apagou o pedido: some da Ajuda de custo se ainda não foi pago
    DELETE FROM ajudas_custo WHERE expense_id = OLD.id AND status = 'Pendente';
    RETURN OLD;
  END IF;

  IF NEW.category = 'Reembolso' AND NEW.status = 'aprovado' THEN
    -- Já estava aprovado e o valor não mudou (ex.: só anexou a nota): não mexe,
    -- para não desfazer o que o RH ajustou na tabela
    IF TG_OP = 'UPDATE' AND OLD.status = 'aprovado' AND OLD.category = 'Reembolso'
       AND OLD.amount = NEW.amount AND OLD.description = NEW.description THEN
      RETURN NEW;
    END IF;
    cli := NEW.client_id;
    IF cli IS NULL THEN
      SELECT l.client_id INTO cli FROM employee_client_links l
       WHERE l.employee_id = NEW.employee_id
         AND (l.contract_end_date IS NULL OR l.contract_end_date >= current_date)
       ORDER BY l.created_at LIMIT 1;
    END IF;
    INSERT INTO ajudas_custo (employee_id, client_id, periodo, inicio, fim, tipo, descricao, valor, status, expense_id)
    VALUES (NEW.employee_id, cli, 'semana', seg, seg + 6, 'Reembolso', NEW.description, NEW.amount, 'Pendente', NEW.id)
    ON CONFLICT (expense_id) DO UPDATE
       SET valor = EXCLUDED.valor, descricao = EXCLUDED.descricao
     WHERE ajudas_custo.status = 'Pendente';
  ELSE
    -- Negado, voltou para pendente ou deixou de ser reembolso: sai (se não foi pago)
    DELETE FROM ajudas_custo WHERE expense_id = NEW.id AND status = 'Pendente';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reembolso_para_ajuda ON employee_expenses;
CREATE TRIGGER reembolso_para_ajuda AFTER INSERT OR UPDATE ON employee_expenses
  FOR EACH ROW EXECUTE FUNCTION reembolso_para_ajuda();
DROP TRIGGER IF EXISTS reembolso_para_ajuda_apagar ON employee_expenses;
CREATE TRIGGER reembolso_para_ajuda_apagar BEFORE DELETE ON employee_expenses
  FOR EACH ROW EXECUTE FUNCTION reembolso_para_ajuda();

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 1 · 2
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'ajudas_custo' AND column_name = 'expense_id') AS coluna,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('reembolso_para_ajuda', 'reembolso_para_ajuda_apagar')) AS gatilhos;
