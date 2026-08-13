-- ============================================================
-- EXTRAIR_SCHEMA_REAL.sql — gera o CREATE TABLE de tudo que existe hoje
-- ------------------------------------------------------------
-- POR QUE ISTO EXISTE
-- O schema.sql do repositório descreve 21 tabelas, mas o sistema usa 36.
-- Oito delas nunca foram salvas em lugar nenhum — foram criadas direto no
-- painel do Supabase:
--
--   nutritionist_visits, nutritionist_agenda, client_units,
--   schedule_notices, client_contracts, shared_documents,
--   employee_questions
--
-- São justamente as visitas, a agenda e as unidades com valor de vistoria.
-- Hoje, se o projeto no Supabase for perdido, a ESTRUTURA dessas tabelas
-- não existe em nenhum backup — só os dados, em JSON, sem onde colocar.
--
-- COMO USAR
-- 1. Cole isto no SQL Editor do Supabase e rode.
-- 2. Copie a coluna "ddl" do resultado inteiro.
-- 3. Salve como supabase/schema_real.sql e faça commit.
--
-- Repita sempre que criar ou alterar tabela pelo painel.
-- ============================================================

SELECT string_agg(ddl, E'\n\n' ORDER BY tablename) AS ddl
FROM (
  SELECT
    c.relname AS tablename,
    'CREATE TABLE IF NOT EXISTS ' || c.relname || E' (\n' ||
    string_agg(
      '  ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ||
      CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END ||
      CASE WHEN ad.adbin IS NOT NULL
           THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid)
           ELSE '' END,
      E',\n' ORDER BY a.attnum
    ) || E'\n);' ||
    -- Chaves primárias, estrangeiras, únicas e checks da tabela
    COALESCE(E'\n' || (
      SELECT string_agg(
        'ALTER TABLE ' || c.relname || ' ADD CONSTRAINT ' || con.conname ||
        ' ' || pg_get_constraintdef(con.oid) || ';', E'\n' ORDER BY con.conname)
      FROM pg_constraint con
      WHERE con.conrelid = c.oid
    ), '') AS ddl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.oid, c.relname
) t;
