-- ============================================================
-- Migration 109 — Candidato: idade, faixa de refeições e data da resposta
-- ------------------------------------------------------------
-- Achado ao conferir a planilha do Forms que o Gabriel mandou em 18/11/2026:
--   · "Idade" não era guardada em lugar nenhum;
--   · o volume de refeições vinha como faixa ("1.000 a 5.000") e era gravado
--     como número cortado: 414 candidatos ficaram com volume 1 (o certo é
--     1.000) e quem marcou "Acima de 5.000" ficou vazio;
--   · a data da resposta (migração 086) nunca tinha sido criada neste banco,
--     então reimportar não atualizava ninguém nem ordenava por resposta.
-- Acrescenta colunas e conserta o volume de quem já está no banco.
-- Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS idade text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS volume_refeicoes text;

-- O que a 086 fazia (data da resposta do formulário)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS respondido_em timestamptz;
ALTER TABLE candidates ALTER COLUMN respondido_em SET DEFAULT now();
CREATE INDEX IF NOT EXISTS candidates_respondido_em ON candidates (respondido_em DESC NULLS LAST);

-- Volume já gravado: 1 era "1.000 a 5.000". Os outros números estavam certos
-- como mínimo; só ganham a faixa escrita. (Os vazios se resolvem ao reimportar.)
UPDATE candidates SET max_meals_volume = 1000 WHERE max_meals_volume = 1;
UPDATE candidates
   SET volume_refeicoes = CASE max_meals_volume
         WHEN 1000 THEN '1.000 a 5.000' WHEN 500 THEN '500 a 1.000'
         WHEN 200 THEN '200 a 500'      WHEN 100 THEN '100 a 200' END
 WHERE volume_refeicoes IS NULL AND max_meals_volume IN (100, 200, 500, 1000);

NOTIFY pgrst, 'reload schema';

-- Conferência: ninguém mais com volume 1
SELECT count(*) AS candidatos,
       count(*) FILTER (WHERE max_meals_volume = 1) AS com_volume_1_deve_dar_0,
       count(volume_refeicoes) AS com_faixa,
       count(respondido_em) AS com_data_da_resposta
  FROM candidates;
