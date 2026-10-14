-- ============================================================
-- 093 — Reembolso: no salário ou na próxima segunda (pedido de 14/10/2026)
-- "Só no Soluções Ponta Grossa vamos ter ajuda de custo semanal. O resto é no
--  salário, mas antes de aprovar eu posso jogar pra pagar na primeira
--  segunda-feira que vier."
--
-- Antes (090): TODO reembolso aprovado ia para a Ajuda de custo da semana.
-- Agora:
--   • Padrão = o contrato. Vínculo com ajuda de custo SEMANAL → próxima
--     segunda. Os demais → fica no salário e sai no dia de pagamento da pessoa
--     (8, 15 ou 20), somado pela folha.
--   • Na aprovação o RH escolhe a exceção: employee_expenses.pagar_na_semana
--     (true = próxima segunda · false = salário · null = segue o contrato).
--   • "Próxima segunda": a primeira segunda a partir de hoje (hoje, se for segunda).
-- Nada pago muda. Reembolso que JÁ está na Ajuda de custo continua lá:
-- ver CONFERIR_REEMBOLSOS_NA_SEGUNDA.sql (só leitura).
-- Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE employee_expenses ADD COLUMN IF NOT EXISTS pagar_na_semana boolean;
COMMENT ON COLUMN employee_expenses.pagar_na_semana IS
  'Reembolso: true = Ajuda de custo da próxima segunda; false = no salário; null = segue o contrato (ajuda semanal → segunda).';

CREATE OR REPLACE FUNCTION reembolso_para_ajuda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  seg date;
  cli uuid;
  na_semana boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ajudas_custo WHERE expense_id = OLD.id AND status = 'Pendente';
    RETURN OLD;
  END IF;

  IF NEW.category = 'Reembolso' AND NEW.status = 'aprovado' THEN
    -- Nada que importe mudou (ex.: só anexou a nota): não mexe no que o RH ajustou
    IF TG_OP = 'UPDATE' AND OLD.status = 'aprovado' AND OLD.category = 'Reembolso'
       AND OLD.amount = NEW.amount AND OLD.description = NEW.description
       AND OLD.pagar_na_semana IS NOT DISTINCT FROM NEW.pagar_na_semana THEN
      RETURN NEW;
    END IF;

    cli := NEW.client_id;
    IF cli IS NULL THEN
      SELECT l.client_id INTO cli FROM employee_client_links l
       WHERE l.employee_id = NEW.employee_id
         AND (l.contract_end_date IS NULL OR l.contract_end_date >= hoje)
       ORDER BY (l.cost_assistance_periodo = 'semana' AND coalesce(l.cost_assistance, 0) > 0) DESC, l.created_at
       LIMIT 1;
    END IF;

    na_semana := coalesce(NEW.pagar_na_semana, EXISTS (
      SELECT 1 FROM employee_client_links l
       WHERE l.employee_id = NEW.employee_id
         AND (cli IS NULL OR l.client_id = cli)
         AND l.cost_assistance_periodo = 'semana' AND coalesce(l.cost_assistance, 0) > 0
         AND (l.contract_end_date IS NULL OR l.contract_end_date >= hoje)));

    IF NOT na_semana THEN
      -- No salário: a folha soma (ela só pula o que está na Ajuda de custo)
      DELETE FROM ajudas_custo WHERE expense_id = NEW.id AND status = 'Pendente';
      RETURN NEW;
    END IF;

    seg := hoje + ((8 - extract(isodow FROM hoje)::int) % 7);   -- próxima segunda (hoje, se for segunda)
    INSERT INTO ajudas_custo (employee_id, client_id, periodo, inicio, fim, tipo, descricao, valor, status, expense_id)
    VALUES (NEW.employee_id, cli, 'semana', seg, seg + 6, 'Reembolso', NEW.description, NEW.amount, 'Pendente', NEW.id)
    ON CONFLICT (expense_id) DO UPDATE
       SET valor = EXCLUDED.valor, descricao = EXCLUDED.descricao
     WHERE ajudas_custo.status = 'Pendente';
  ELSE
    DELETE FROM ajudas_custo WHERE expense_id = NEW.id AND status = 'Pendente';
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferir: coluna = 1 e gatilhos = 2
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'employee_expenses' AND column_name = 'pagar_na_semana') AS coluna,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('reembolso_para_ajuda', 'reembolso_para_ajuda_apagar')) AS gatilhos;
