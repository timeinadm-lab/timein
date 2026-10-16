-- Só leitura (16/10/2026): vínculos com dois dias de pagamento que NÃO são 8 e 20
-- (regra: um dia 8, 15 ou 20; ou os dois 8 e 20). Corrija na ficha do colaborador.
SELECT e.full_name AS colaborador, c.name AS cliente, string_agg(d.day_of_month::text, ' e ' ORDER BY d.day_of_month) AS dias
  FROM employee_payment_dates d
  JOIN employee_client_links l ON l.id = d.link_id
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN clients c ON c.id = l.client_id
 WHERE l.contract_end_date IS NULL OR l.contract_end_date >= current_date
 GROUP BY e.full_name, c.name, l.id
HAVING count(DISTINCT d.day_of_month) > 1
   AND array_agg(DISTINCT d.day_of_month ORDER BY d.day_of_month) <> ARRAY[8, 20]
 ORDER BY 1;
