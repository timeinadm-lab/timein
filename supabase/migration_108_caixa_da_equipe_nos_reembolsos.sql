-- ============================================================
-- Migration 108 — Compra do caixa da equipe aparece em Reembolsos
-- ------------------------------------------------------------
-- Pedido do Gabriel (09/11/2026): a Giovana lançou R$ 213,81 de passagens e
-- Uber no caixa do "Meu trabalho" e ele não achou. "Esse negócio aparece no
-- nosso sistema também: na planilha e lá em reembolsos, é uma forma de eu ter
-- um controle."
--
-- O que faz:
--   · Toda COMPRA lançada no caixa da equipe vira também um pedido de reembolso
--     (employee_expenses), "Para analisar", com a mesma nota. Daí ela aparece na
--     aba Reembolsos, nas planilhas e segue as regras de pagamento de sempre
--     (aprovar no salário ou na segunda, negar).
--   · Se a pessoa editar a compra, o pedido acompanha enquanto não foi decidido.
--     Se apagar, o pedido some (só se ainda não foi decidido).
--   · O caixa do "Meu trabalho" continua como era (cada um vê o seu).
--   · Já traz as compras que existem hoje (as 3 da Giovana).
-- Quem é a pessoa: o cadastro ligado ao login; se não tiver, o colaborador
-- ativo com o mesmo primeiro e último nome (só se for um só).
-- Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE employee_expenses ADD COLUMN IF NOT EXISTS caixa_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS employee_expenses_caixa_id ON employee_expenses (caixa_id) WHERE caixa_id IS NOT NULL;

CREATE OR REPLACE FUNCTION colaborador_do_login(p_user uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp  uuid;
  nome text;
  ids  uuid[];
BEGIN
  SELECT employee_id, full_name INTO emp, nome FROM user_profiles WHERE id = p_user;
  IF emp IS NOT NULL OR nome IS NULL OR position(' ' IN btrim(nome)) = 0 THEN RETURN emp; END IF;
  SELECT array_agg(e.id) INTO ids FROM employees e
   WHERE e.status = 'Ativo'
     AND e.full_name ILIKE split_part(btrim(nome), ' ', 1) || ' %'
     AND e.full_name ILIKE '% ' || reverse(split_part(reverse(btrim(nome)), ' ', 1));
  RETURN CASE WHEN coalesce(array_length(ids, 1), 0) = 1 THEN ids[1] END;
END$$;
REVOKE ALL ON FUNCTION colaborador_do_login(uuid) FROM public, anon;

CREATE OR REPLACE FUNCTION caixa_para_reembolso() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nome text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM employee_expenses WHERE caixa_id = OLD.id AND status = 'pendente';
    RETURN OLD;
  END IF;

  IF NEW.tipo <> 'compra' THEN
    DELETE FROM employee_expenses WHERE caixa_id = NEW.id AND status = 'pendente';
    RETURN NEW;
  END IF;

  SELECT full_name INTO nome FROM user_profiles WHERE id = NEW.user_id;
  INSERT INTO employee_expenses (employee_id, amount, description, category, reference_month, receipt_url,
                                 notes, client_id, status, created_at, caixa_id)
  VALUES (colaborador_do_login(NEW.user_id), NEW.valor, NEW.descricao, 'Reembolso', to_char(NEW.data, 'YYYY-MM'),
          NEW.comprovante,
          'Caixa da equipe (Meu trabalho) · lançado por ' || coalesce(nome, '?') || ' · compra de ' || to_char(NEW.data, 'DD/MM/YYYY'),
          NEW.client_id, 'pendente', NEW.criado_em, NEW.id)
  ON CONFLICT (caixa_id) WHERE caixa_id IS NOT NULL DO UPDATE
     SET amount = EXCLUDED.amount, description = EXCLUDED.description, reference_month = EXCLUDED.reference_month,
         receipt_url = EXCLUDED.receipt_url, notes = EXCLUDED.notes, client_id = EXCLUDED.client_id
   WHERE employee_expenses.status = 'pendente';
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS caixa_para_reembolso ON equipe_caixa;
CREATE TRIGGER caixa_para_reembolso AFTER INSERT OR UPDATE ON equipe_caixa
  FOR EACH ROW EXECUTE FUNCTION caixa_para_reembolso();
DROP TRIGGER IF EXISTS caixa_para_reembolso_apagar ON equipe_caixa;
CREATE TRIGGER caixa_para_reembolso_apagar AFTER DELETE ON equipe_caixa
  FOR EACH ROW EXECUTE FUNCTION caixa_para_reembolso();

-- Compras que já existem: entram agora (o UPDATE sem mudança dispara o gatilho)
UPDATE equipe_caixa SET tipo = tipo WHERE tipo = 'compra';

NOTIFY pgrst, 'reload schema';

-- Conferência: as compras do caixa e o pedido de reembolso de cada uma
SELECT p.full_name AS quem_lancou, c.data, c.valor, c.descricao,
       e.full_name AS no_reembolso_de, x.status, x.reference_month AS mes
  FROM equipe_caixa c
  JOIN user_profiles p ON p.id = c.user_id
  LEFT JOIN employee_expenses x ON x.caixa_id = c.id
  LEFT JOIN employees e ON e.id = x.employee_id
 WHERE c.tipo = 'compra'
 ORDER BY c.data;
