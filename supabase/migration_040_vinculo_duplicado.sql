-- ============================================================
-- Migration 040 — Vínculo duplicado no mesmo cliente
-- ------------------------------------------------------------
-- ⚠️  NÃO CRIE O ÍNDICE ÚNICO. Ver nota no fim do arquivo.
--
-- Contexto: a folha percorre TODOS os vínculos, mas o portal só enxergava
-- o PRIMEIRO de cada cliente. Com dois vínculos no mesmo cliente isso dava
-- pagamento em dobro (as visitas casam por colaborador + cliente, não por
-- vínculo).
--
-- Já corrigido no código (17/08/2026):
--   • a folha desempata pelo período: o freela fica com as visitas dentro
--     da janela dele; o vínculo fixo fica com o resto
--   • o portal escolhe o vínculo pelo dia do registro
--   • o formulário bloqueia dois vínculos FIXOS no mesmo cliente
-- ============================================================

-- Diagnóstico: quem tem mais de um vínculo ativo no mesmo cliente.
-- Consultoria + Volante é LEGÍTIMO (a consultora fixa que também cobriu
-- dias avulsos). Dois vínculos fixos é que é erro de cadastro.
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

-- ------------------------------------------------------------
-- POR QUE O ÍNDICE ÚNICO FOI DESCARTADO
-- ------------------------------------------------------------
-- A primeira versão desta migração criava:
--
--   CREATE UNIQUE INDEX uniq_link_ativo_por_cliente
--     ON employee_client_links (employee_id, client_id)
--     WHERE contract_end_date IS NULL;
--
-- Ele bloquearia o caso real encontrado em 17/08/2026 (Mariane Cardoso de
-- Oliveira: Consultoria + Volante na GR Auditoria) — que é uso correto, não
-- duplicidade. A regra "dois vínculos fixos não" vive no formulário, onde
-- consegue distinguir permanente de freela. NÃO recrie o índice.
-- ============================================================
