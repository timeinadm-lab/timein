-- Rodar DEPOIS da 093. Só leitura: reembolsos que a regra antiga mandou para a segunda, ainda
--    a pagar, de quem NÃO tem ajuda semanal. Pela regra nova iriam no salário.
--    Para mudar um: na tela, ou UPDATE employee_expenses SET pagar_na_semana = false WHERE id = '...';
SELECT e.full_name AS pessoa, x.description AS reembolso, x.amount AS valor,
       to_char(a.inicio, 'DD/MM') AS semana, x.id AS expense_id
  FROM ajudas_custo a
  JOIN employee_expenses x ON x.id = a.expense_id
  JOIN employees e ON e.id = a.employee_id
 WHERE a.status = 'Pendente'
   AND NOT EXISTS (SELECT 1 FROM employee_client_links l
                    WHERE l.employee_id = a.employee_id
                      AND l.cost_assistance_periodo = 'semana' AND coalesce(l.cost_assistance, 0) > 0
                      AND (l.contract_end_date IS NULL OR l.contract_end_date >= current_date))
 ORDER BY e.full_name;
