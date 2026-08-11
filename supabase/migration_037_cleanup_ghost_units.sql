-- ============================================================
-- Migration 037 — Limpa unidades "fantasma" já existentes no banco
-- ------------------------------------------------------------
-- link_units (em employee_client_links) e vacancy_units (em vacancies)
-- guardam uma CÓPIA (unit_id, unit_name, visit_rate) da unidade, não uma
-- referência viva. Quando uma unidade era excluída em Clientes → Unidades,
-- essa cópia ficava presa lá pra sempre — some da tela mas continua
-- entrando na média/estimativa mensal escondida (foi isso que inflou o
-- vínculo da Vanielle Fernandes Lima / Mercado Livre - Auditoria de
-- R$150 pra R$1.100).
--
-- A partir de agora (código já corrigido) isso não acontece mais na
-- exclusão. Esta migração é a limpeza ÚNICA do que já ficou preso.
-- ============================================================

-- 1) Remove do link_units qualquer entrada cujo unit_id não existe mais em client_units
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

-- 2) Mesma limpeza em vacancy_units (vagas)
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

-- 3) Recalcula a estimativa mensal (monthly_amount) dos vínculos de Consultoria
--    já limpos, usando a frequência certa (Mensal=1x, Quinzenal=2x, Semanal=4x)
UPDATE employee_client_links ecl
SET monthly_amount = ROUND(
  (SELECT AVG((elem->>'visit_rate')::numeric) FROM jsonb_array_elements(ecl.link_units) elem)
  * CASE ecl.visit_frequency WHEN 'Mensal' THEN 1 WHEN 'Quinzenal' THEN 2 ELSE 4 END
, 2)
WHERE ecl.service_type = 'Consultoria'
  AND ecl.link_units IS NOT NULL
  AND jsonb_array_length(ecl.link_units) > 0;

NOTIFY pgrst, 'reload schema';
