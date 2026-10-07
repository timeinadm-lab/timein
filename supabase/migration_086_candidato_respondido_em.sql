-- ============================================================
-- Migration 086 — Data da resposta do candidato
-- ------------------------------------------------------------
-- Pedido de 07/10/2026: ordenar Candidatos pela data em que a pessoa
-- respondeu o formulário ("Carimbo de data/hora" da planilha). Quem
-- refaz o formulário tem os dados e a data atualizados e sobe para os
-- recentes. Quem já está no banco fica SEM data até a próxima importação
-- da planilha (as importações antigas guardaram a 1ª resposta; a próxima
-- importação troca pela última). Cadastro novo à mão: data de agora.
-- Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS respondido_em timestamptz;
ALTER TABLE candidates ALTER COLUMN respondido_em SET DEFAULT now();
CREATE INDEX IF NOT EXISTS candidates_respondido_em ON candidates (respondido_em DESC NULLS LAST);

NOTIFY pgrst, 'reload schema';

-- Conferência: total, com data e sem data (sem data = esperando a próxima importação)
SELECT count(*) AS candidatos,
       count(respondido_em) AS com_data,
       count(*) FILTER (WHERE respondido_em IS NULL) AS sem_data
  FROM candidates;
