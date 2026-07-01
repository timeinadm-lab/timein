-- ============================================================
-- MIGRATION 019 — Limpeza de candidatos duplicados
-- ============================================================
-- ⚠️  IMPORTANTE — Antes de rodar:
--   1. Rode PRIMEIRO a "PARTE A (PREVIEW)" abaixo pra ver quantos
--      seriam apagados. Nada muda no banco.
--   2. Se o número fizer sentido, rode a "PARTE B (LIMPEZA)".
--      Ela roda dentro de uma transação — se algo der errado,
--      nada é aplicado.
--
-- Estratégia de match (do mais forte pro mais fraco):
--   1. WhatsApp normalizado (só dígitos, com pelo menos 10) — MESMA PESSOA
--   2. E-mail (lowercase, sem espaço)                       — MESMA PESSOA
--   Registros SEM WhatsApp e SEM e-mail NÃO são deduplicados
--   (nome+cidade é frágil demais pra rodar em massa).
--
-- Regra de escolha: mantém o candidato MAIS ANTIGO de cada grupo
-- (created_at ASC) — é o que provavelmente tem entrevistas/vagas linkadas.
-- Entrevistas, contatos e interesses em vaga das duplicatas mais novas
-- são MIGRADOS pro registro mais antigo antes da exclusão — nada se perde.

-- ============================================================
-- PARTE A — PREVIEW (só executa isto pra ver o que aconteceria)
-- ============================================================
--
-- Copie e cole ESTE bloco no SQL editor do Supabase:
--
/*
WITH normalized AS (
  SELECT
    id,
    created_at,
    regexp_replace(COALESCE(whatsapp, ''), '\D', '', 'g') AS wa,
    LOWER(TRIM(COALESCE(email, '')))                     AS em
  FROM candidates
),
grouped AS (
  SELECT
    id, created_at,
    CASE
      WHEN LENGTH(wa) >= 10 THEN 'w:' || wa
      WHEN em <> ''         THEN 'e:' || em
      ELSE NULL
    END AS group_key
  FROM normalized
),
ranked AS (
  SELECT
    id, group_key, created_at,
    FIRST_VALUE(id) OVER (PARTITION BY group_key ORDER BY created_at ASC, id ASC) AS keeper_id,
    ROW_NUMBER()    OVER (PARTITION BY group_key ORDER BY created_at ASC, id ASC) AS rn
  FROM grouped
  WHERE group_key IS NOT NULL
)
SELECT
  (SELECT COUNT(*) FROM candidates)              AS total_hoje,
  COUNT(*) FILTER (WHERE rn > 1)                 AS duplicatas_a_apagar,
  COUNT(DISTINCT keeper_id) FILTER (WHERE rn > 1) AS grupos_afetados,
  (SELECT COUNT(*) FROM candidates) - COUNT(*) FILTER (WHERE rn > 1) AS total_apos_limpeza
FROM ranked;
*/

-- ============================================================
-- PARTE B — LIMPEZA (só rode DEPOIS de conferir o preview)
-- ============================================================
-- Roda tudo dentro de uma transação. Se qualquer passo falhar,
-- nada é aplicado. Ao final, exibe o total de candidatos restantes.

BEGIN;

-- 1. Monta o mapa dup -> keeper
CREATE TEMP TABLE dup_map ON COMMIT DROP AS
WITH normalized AS (
  SELECT
    id,
    created_at,
    regexp_replace(COALESCE(whatsapp, ''), '\D', '', 'g') AS wa,
    LOWER(TRIM(COALESCE(email, '')))                     AS em
  FROM candidates
),
grouped AS (
  SELECT
    id, created_at,
    CASE
      WHEN LENGTH(wa) >= 10 THEN 'w:' || wa
      WHEN em <> ''         THEN 'e:' || em
      ELSE NULL
    END AS group_key
  FROM normalized
),
ranked AS (
  SELECT
    id, group_key, created_at,
    FIRST_VALUE(id) OVER (PARTITION BY group_key ORDER BY created_at ASC, id ASC) AS keeper_id,
    ROW_NUMBER()    OVER (PARTITION BY group_key ORDER BY created_at ASC, id ASC) AS rn
  FROM grouped
  WHERE group_key IS NOT NULL
)
SELECT id AS dup_id, keeper_id
FROM ranked
WHERE rn > 1;

-- 2. Migra entrevistas das duplicatas pro keeper
UPDATE interviews i
SET candidate_id = m.keeper_id
FROM dup_map m
WHERE i.candidate_id = m.dup_id;

-- 3. Migra histórico de contatos
UPDATE candidate_contacts c
SET candidate_id = m.keeper_id
FROM dup_map m
WHERE c.candidate_id = m.dup_id;

-- 4. Migra interesses em vaga — cuidado com UNIQUE(vacancy_id, candidate_id)
-- Se o keeper já tem interesse nessa vaga, apaga o da duplicata primeiro
DELETE FROM vacancy_interests vi
USING dup_map m
WHERE vi.candidate_id = m.dup_id
  AND EXISTS (
    SELECT 1 FROM vacancy_interests vi2
    WHERE vi2.candidate_id = m.keeper_id
      AND vi2.vacancy_id  = vi.vacancy_id
  );
-- Move os que sobraram (sem conflito)
UPDATE vacancy_interests vi
SET candidate_id = m.keeper_id
FROM dup_map m
WHERE vi.candidate_id = m.dup_id;

-- 5. Apaga as duplicatas
DELETE FROM candidates c
USING dup_map m
WHERE c.id = m.dup_id;

COMMIT;

-- 6. Resumo final
SELECT COUNT(*) AS candidatos_restantes FROM candidates;
