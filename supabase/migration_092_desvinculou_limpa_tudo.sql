-- ============================================================
-- 092 — Desvinculou / desligou: nada "a pagar" nem "agendado" sobra depois
-- (pedido de 14/10/2026: "o Diego já foi desvinculado e ainda está na ajuda
--  de custo… tudo é ligado como um sistema nervoso… que não aconteça nunca mais")
--
-- O que estava errado (auditoria):
--   1. Só alguns botões limpavam a ajuda semanal ao encerrar (ficha). O
--      "Desligar" da vaga e o "prolongar contrato" não limpavam nada.
--   2. Ajuda lançada à mão (Alimentação, Uber… sem link_id) nunca era limpa.
--   3. Mudar a pessoa para Inativo não tirava nada.
--   4. Dava para lançar ajuda para quem não tem vínculo naquela semana.
--
-- Agora quem garante é o BANCO, valha por onde for (ficha, vaga, SQL):
--   A. Fim do vínculo mudou / vínculo apagado → some o "Pendente" das semanas
--      que começam DEPOIS do último dia daquela pessoa naquele cliente, e a
--      agenda futura depois desse dia. PAGO NUNCA SAI. Reembolso aprovado
--      (expense_id) também fica: é dinheiro que ela gastou e tem a receber.
--   B. Pessoa virou Inativo → o mesmo, a partir do desligamento (ou de hoje).
--   C. Não entra ajuda nova sem vínculo valendo na semana (nem para Inativo
--      depois do desligamento). Reembolso aprovado passa sempre.
-- Só vale daqui pra frente. O que JÁ sobrou: ver AUDITORIA_AJUDA_DESVINCULADOS.sql.
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- ============================================================

-- Último dia coberto por algum vínculo da pessoa no cliente (NULL = sem fim; '-infinity' = nenhum vínculo)
CREATE OR REPLACE FUNCTION ultimo_dia_do_vinculo(p_emp uuid, p_cli uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM employee_client_links WHERE employee_id = p_emp AND client_id IS NOT DISTINCT FROM p_cli) THEN '-infinity'::date
    WHEN EXISTS (SELECT 1 FROM employee_client_links WHERE employee_id = p_emp AND client_id IS NOT DISTINCT FROM p_cli AND contract_end_date IS NULL) THEN NULL
    ELSE (SELECT max(contract_end_date) FROM employee_client_links WHERE employee_id = p_emp AND client_id IS NOT DISTINCT FROM p_cli)
  END
$$;

-- Tira o que ficou "a pagar" / "agendado" depois de um dia (de UMA pessoa)
CREATE OR REPLACE FUNCTION limpar_depois_de(p_emp uuid, p_cli uuid, p_dia date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_dia IS NULL OR p_emp IS NULL THEN RETURN; END IF;
  DELETE FROM ajudas_custo
   WHERE employee_id = p_emp
     AND (p_cli IS NULL OR client_id IS NOT DISTINCT FROM p_cli)
     AND status = 'Pendente' AND expense_id IS NULL
     AND inicio > p_dia;
  IF to_regclass('public.nutritionist_agenda') IS NOT NULL THEN
    DELETE FROM nutritionist_agenda
     WHERE employee_id = p_emp
       AND (p_cli IS NULL OR client_id IS NOT DISTINCT FROM p_cli)
       AND planned_date > p_dia AND planned_date >= current_date;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION limpar_depois_de(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- A. Vínculo encerrado, encurtado, apagado ou com início mudado
CREATE OR REPLACE FUNCTION vinculo_mudou_limpa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM limpar_depois_de(r.employee_id, r.client_id, ultimo_dia_do_vinculo(r.employee_id, r.client_id));
  -- Semanas do contrato antes do (novo) início
  IF TG_OP = 'UPDATE' AND NEW.start_date IS NOT NULL THEN
    DELETE FROM ajudas_custo WHERE link_id = NEW.id AND status = 'Pendente' AND fim < NEW.start_date;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_vinculo_mudou_limpa ON employee_client_links;
CREATE TRIGGER trg_vinculo_mudou_limpa
  AFTER UPDATE OF contract_end_date, start_date OR DELETE ON employee_client_links
  FOR EACH ROW EXECUTE FUNCTION vinculo_mudou_limpa();

-- B. Pessoa desligada (Inativo)
CREATE OR REPLACE FUNCTION pessoa_desligada_limpa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Inativo' AND OLD.status IS DISTINCT FROM 'Inativo' THEN
    PERFORM limpar_depois_de(NEW.id, NULL, coalesce(NEW.dismissal_date, current_date));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_pessoa_desligada_limpa ON employees;
CREATE TRIGGER trg_pessoa_desligada_limpa
  AFTER UPDATE OF status ON employees
  FOR EACH ROW EXECUTE FUNCTION pessoa_desligada_limpa();

-- C. Ajuda nova só com vínculo valendo na semana
CREATE OR REPLACE FUNCTION ajuda_exige_vinculo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_saida date;
BEGIN
  IF NEW.expense_id IS NOT NULL OR NEW.employee_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, dismissal_date INTO v_status, v_saida FROM employees WHERE id = NEW.employee_id;
  IF v_status = 'Inativo' AND NEW.inicio > coalesce(v_saida, current_date) THEN
    RAISE EXCEPTION 'Pessoa desligada: não entra ajuda de custo depois de %', to_char(coalesce(v_saida, current_date), 'DD/MM/YYYY');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM employee_client_links l
     WHERE l.employee_id = NEW.employee_id
       AND (NEW.client_id IS NULL OR l.client_id = NEW.client_id)
       AND (l.start_date IS NULL OR l.start_date <= NEW.fim)
       AND (l.contract_end_date IS NULL OR l.contract_end_date >= NEW.inicio)
  ) THEN
    RAISE EXCEPTION 'Sem vínculo valendo de % a %: não entra ajuda de custo nesse período', to_char(NEW.inicio, 'DD/MM'), to_char(NEW.fim, 'DD/MM');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ajuda_exige_vinculo ON ajudas_custo;
CREATE TRIGGER trg_ajuda_exige_vinculo
  BEFORE INSERT ON ajudas_custo
  FOR EACH ROW EXECUTE FUNCTION ajuda_exige_vinculo();

NOTIFY pgrst, 'reload schema';

-- Conferir: tem que dar 3
SELECT count(*) AS gatilhos FROM pg_trigger
WHERE tgname IN ('trg_vinculo_mudou_limpa', 'trg_pessoa_desligada_limpa', 'trg_ajuda_exige_vinculo');
