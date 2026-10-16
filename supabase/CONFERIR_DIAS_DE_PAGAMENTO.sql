-- Só leitura (16/10/2026): vínculos com dias de pagamento fora da regra.
-- Regra: FIXO recebe uma vez (8, 15 ou 20). Só CONSULTORIA pode receber duas vezes, e aí é 8 e 20.
SELECT e.full_name AS colaborador, c.name AS cliente, l.service_type AS tipo,
       string_agg(d.day_of_month::text, ' e ' ORDER BY d.day_of_month) AS dias
  FROM employee_payment_dates d
  JOIN employee_client_links l ON l.id = d.link_id
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN clients c ON c.id = l.client_id
 WHERE l.contract_end_date IS NULL OR l.contract_end_date >= current_date
 GROUP BY e.full_name, c.name, l.id, l.service_type
HAVING count(DISTINCT d.day_of_month) > 1
   AND (l.service_type <> 'Consultoria' OR array_agg(DISTINCT d.day_of_month ORDER BY d.day_of_month) <> ARRAY[8, 20])
 ORDER BY 1;
