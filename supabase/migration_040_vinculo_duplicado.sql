-- ============================================================
-- Migration 040 — Vínculo duplicado no mesmo cliente
-- ------------------------------------------------------------
-- A folha percorre TODOS os vínculos (links.map), mas o portal só enxerga
-- o PRIMEIRO de cada cliente (find). Resultado de um vínculo duplicado:
--   • a pessoa bate ponto em um deles
--   • o outro gera um segundo lançamento na folha, sem visitas
--   • ou seja, PAGAMENTO EM DOBRO
--
-- Antes isso era improvável porque vincular exigia passar pela vaga.
-- Com o "+ Vincular" rápido, virou um clique duplo.
--
-- O código já bloqueia. Isto aqui é a rede de segurança no banco.
-- ============================================================

-- 1) PRIMEIRO: veja se já existe duplicado hoje. Rode SÓ este SELECT antes.
SELECT
  e.full_name                         AS colaborador,
  c.name                              AS cliente,
  count(*)                            AS vinculos,
  string_agg(ecl.service_type, ' + ') AS tipos,
  string_agg(ecl.id::text, ', ')      AS ids
FROM employee_client_links ecl
JOIN employees e ON e.id = ecl.employee_id
JOIN clients   c ON c.id = ecl.client_id
WHERE ecl.contract_end_date IS NULL OR ecl.contract_end_date >= CURRENT_DATE
GROUP BY e.full_name, c.name, ecl.employee_id, ecl.client_id
HAVING count(*) > 1
ORDER BY count(*) DESC;

-- 2) Se o SELECT acima voltar VAZIO, rode o índice abaixo.
--    Se voltar linhas, resolva os duplicados primeiro (apague o vínculo
--    errado na ficha do colaborador) — senão o índice falha ao ser criado.
--
--    O índice só cobre vínculos ATIVOS (sem data de fim): assim a pessoa
--    ainda pode ter um freela encerrado e um vínculo novo no mesmo cliente.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_link_ativo_por_cliente
  ON employee_client_links (employee_id, client_id)
  WHERE contract_end_date IS NULL;

NOTIFY pgrst, 'reload schema';
