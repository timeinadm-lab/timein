-- ============================================================
-- RODAR AGORA — migrações pendentes (032 a 038)
-- ------------------------------------------------------------
-- Junta tudo que ainda não foi aplicado no banco, na ordem certa.
-- É seguro rodar mais de uma vez: todo comando aqui é idempotente
-- (IF NOT EXISTS / DROP IF EXISTS / UPDATE com WHERE).
--
-- Cole no SQL Editor do Supabase e rode de uma vez só.
-- No fim há uma conferência que mostra se deu tudo certo.
-- ============================================================


-- ── 032 · Freela aceitava só PJ/Consultoria e travava o cadastro ──
ALTER TABLE employee_client_links
  DROP CONSTRAINT IF EXISTS employee_client_links_service_type_check;
ALTER TABLE employee_client_links
  ADD CONSTRAINT employee_client_links_service_type_check
  CHECK (service_type IN ('PJ', 'Consultoria', 'Fixo', 'Volante', 'Ambos'));


-- ── 033 · Compromisso pode existir sem data ("a agendar") ──
ALTER TABLE interviews ALTER COLUMN scheduled_at DROP NOT NULL;


-- ── 034 · Tipo do compromisso (Reunião, Visita, Treinamento...) ──
--    É a coluna que faltava e dava "Could not find the 'category' column"
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS category TEXT;


-- ── 035 · Visita na agenda: vincula cliente e guarda o mês de referência ──
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS target_month DATE;


-- ── 036 · Vários participantes por compromisso (a reunião da Bia) ──
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS participant_ids UUID[] DEFAULT '{}';

-- Quem já tinha um responsável vira o primeiro participante
UPDATE interviews SET participant_ids = ARRAY[recruiter_id]
WHERE recruiter_id IS NOT NULL AND (participant_ids IS NULL OR participant_ids = '{}');


-- ── 037 · Limpa unidades "fantasma" (o R$1.100 da Vanielle) ──
-- Unidade excluída em Clientes continuava presa dentro do vínculo e
-- entrava escondida na média. Isto varre todos os clientes de uma vez.

UPDATE employee_client_links
SET link_units = cleaned.kept
FROM (
  SELECT ecl.id,
         COALESCE(jsonb_agg(elem) FILTER (WHERE cu.id IS NOT NULL), '[]'::jsonb) AS kept
  FROM employee_client_links ecl
  CROSS JOIN LATERAL jsonb_array_elements(ecl.link_units) AS elem
  LEFT JOIN client_units cu ON cu.id = (elem->>'unit_id')::uuid
  WHERE ecl.link_units IS NOT NULL AND jsonb_typeof(ecl.link_units) = 'array'
  GROUP BY ecl.id
) AS cleaned
WHERE employee_client_links.id = cleaned.id;

UPDATE vacancies
SET vacancy_units = cleaned.kept
FROM (
  SELECT v.id,
         COALESCE(jsonb_agg(elem) FILTER (WHERE cu.id IS NOT NULL), '[]'::jsonb) AS kept
  FROM vacancies v
  CROSS JOIN LATERAL jsonb_array_elements(v.vacancy_units) AS elem
  LEFT JOIN client_units cu ON cu.id = (elem->>'unit_id')::uuid
  WHERE v.vacancy_units IS NOT NULL AND jsonb_typeof(v.vacancy_units) = 'array'
  GROUP BY v.id
) AS cleaned
WHERE vacancies.id = cleaned.id;

-- Recalcula a estimativa mensal já sem fantasma e com a frequência certa
-- (Mensal = 1x, Quinzenal = 2x, Semanal = 4x — antes multiplicava sempre por 4)
UPDATE employee_client_links ecl
SET monthly_amount = ROUND(
  (SELECT AVG((elem->>'visit_rate')::numeric) FROM jsonb_array_elements(ecl.link_units) elem)
  * CASE ecl.visit_frequency WHEN 'Mensal' THEN 1 WHEN 'Quinzenal' THEN 2 ELSE 4 END
, 2)
WHERE ecl.service_type = 'Consultoria'
  AND ecl.link_units IS NOT NULL
  AND jsonb_array_length(ecl.link_units) > 0;


-- ── 038 · Foto no perfil do pessoal do RH ──
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;


-- ── Recarrega o cache da API (sem isto o site continua vendo o schema antigo) ──
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA — todas as linhas devem sair como "OK"
-- ============================================================
SELECT 'interviews.category'        AS item, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='interviews' AND column_name='category')        THEN 'OK' ELSE 'FALTANDO' END AS status
UNION ALL SELECT 'interviews.client_id',       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='interviews' AND column_name='client_id')       THEN 'OK' ELSE 'FALTANDO' END
UNION ALL SELECT 'interviews.target_month',    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='interviews' AND column_name='target_month')    THEN 'OK' ELSE 'FALTANDO' END
UNION ALL SELECT 'interviews.participant_ids', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='interviews' AND column_name='participant_ids') THEN 'OK' ELSE 'FALTANDO' END
UNION ALL SELECT 'user_profiles.photo_url',    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='photo_url')    THEN 'OK' ELSE 'FALTANDO' END
UNION ALL SELECT 'interviews.scheduled_at aceita vazio', CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_name='interviews' AND column_name='scheduled_at') = 'YES' THEN 'OK' ELSE 'FALTANDO' END
UNION ALL SELECT 'unidades fantasma restantes', CASE WHEN (
  SELECT count(*) FROM employee_client_links ecl
  CROSS JOIN LATERAL jsonb_array_elements(ecl.link_units) elem
  LEFT JOIN client_units cu ON cu.id = (elem->>'unit_id')::uuid
  WHERE ecl.link_units IS NOT NULL AND jsonb_typeof(ecl.link_units)='array' AND cu.id IS NULL
) = 0 THEN 'OK' ELSE 'AINDA TEM' END;
