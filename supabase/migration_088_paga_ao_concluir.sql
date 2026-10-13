-- 088 — Contrato que paga ao concluir (pedido de 13/10/2026)
-- "Contrato de 30 dias: ela só recebe quando conclui." Marcado no vínculo, a
-- folha não paga nada nos ciclos antes do fim e paga o contrato inteiro no
-- primeiro dia de pagamento (8, 15 ou 20) depois do último dia.
-- Não muda nenhum vínculo existente: o padrão é falso.

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS paga_ao_concluir boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 1
SELECT count(*) AS coluna_criada FROM information_schema.columns
WHERE table_name = 'employee_client_links' AND column_name = 'paga_ao_concluir';
