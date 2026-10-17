-- ============================================================
-- 098 — Vínculo "SÓ ACESSO" (pedido de 17/10/2026)
-- "Essas pessoas vinculadas em todos os nossos clientes só têm acesso, não
--  têm que cumprir serviço. A gente manda elas cobrir buraco e ela preenche
--  quando for. Não tem obrigação todo mês."
--   • employee_client_links.so_acesso — o vínculo existe para ela poder
--     registrar no portal quando for ao cliente. Sem dia previsto, sem falta,
--     sem pendência de cadastro e sem linha vazia na folha.
--   • O PAGAMENTO NÃO MUDA: se ela registrar, paga como o vínculo manda.
--   • Já marca os vínculos de quem está ligado a 30 clientes ou mais.
-- Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE employee_client_links ADD COLUMN IF NOT EXISTS so_acesso boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN employee_client_links.so_acesso IS
  'Só acesso: pode registrar quando for ao cliente, sem obrigação (sem previstos, faltas nem pendências). Pagamento igual ao do vínculo.';

UPDATE employee_client_links l SET so_acesso = true
 WHERE NOT l.so_acesso
   AND l.employee_id IN (
     SELECT employee_id FROM employee_client_links
      WHERE contract_end_date IS NULL OR contract_end_date >= current_date
      GROUP BY employee_id HAVING count(DISTINCT client_id) >= 30);

NOTIFY pgrst, 'reload schema';

-- Conferir: quem ficou com vínculos "só acesso" (esperado: as pessoas de cobertura)
SELECT e.full_name AS pessoa, count(*) AS vinculos_so_acesso
  FROM employee_client_links l JOIN employees e ON e.id = l.employee_id
 WHERE l.so_acesso GROUP BY e.full_name ORDER BY 1;
