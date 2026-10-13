-- 089 — Datas de pagamento combinadas do contrato (pedido de 13/10/2026)
-- "Ela vai receber só nesse dia: 15/11. Se for contrato de 2, 3 meses, coloco
-- outras datas." Lista de { data, valor } no vínculo. A folha paga cada uma
-- no mês dela e nada nos outros meses. Substitui a caixinha "paga ao concluir"
-- (088): quem já estava marcado continua igual (o sistema sugere a data até o
-- RH salvar a lista).
-- Não muda nenhum vínculo existente: o padrão é vazio.

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS parcelas jsonb;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 1
SELECT count(*) AS coluna_criada FROM information_schema.columns
WHERE table_name = 'employee_client_links' AND column_name = 'parcelas';
