-- ============================================================
-- CONFERÊNCIA DE PAGAMENTOS — só LÊ, não grava nada. Pode rodar quando quiser.
-- Olha o mês atual e o anterior e lista o que pode virar pagamento errado.
-- Cada linha é um problema; no fim, se não houver nada, aparece "Tudo certo".
-- Gravidade: 1 = pode pagar errado · 2 = vai faltar informação · 3 = acompanhar
-- ============================================================
WITH jan AS (
  SELECT (date_trunc('month', current_date) - interval '1 month')::date AS ini,
         (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date AS fim,
         to_char(current_date - interval '1 month', 'YYYY-MM') AS mes_ant,
         to_char(current_date, 'YYYY-MM') AS mes_atu
),
pg AS (   -- lançamentos da janela (por mês trabalhado ou por vencimento), sem cancelados
  SELECT p.*, e.full_name AS pessoa, c.name AS cliente,
         coalesce(p.link_id::text, 'pessoa:' || p.employee_id::text) AS dono
    FROM payments p
    LEFT JOIN employees e ON e.id = p.employee_id
    LEFT JOIN clients   c ON c.id = p.client_id, jan
   WHERE p.status <> 'Cancelado'
     AND (p.reference_month IN (jan.mes_ant, jan.mes_atu) OR p.due_date BETWEEN jan.ini AND jan.fim)
),
vinc AS ( -- vínculos de gente ativa valendo em algum dia da janela
  SELECT l.*, e.full_name AS pessoa, c.name AS cliente,
         (l.service_type = 'Consultoria' AND coalesce(l.pay_mode, 'mensal') <> 'salario_fixo') AS por_visita
    FROM employee_client_links l
    JOIN employees e ON e.id = l.employee_id AND e.status = 'Ativo'
    LEFT JOIN clients c ON c.id = l.client_id, jan
   WHERE (l.start_date IS NULL OR l.start_date <= jan.fim)
     AND (l.contract_end_date IS NULL OR l.contract_end_date >= jan.ini)
),
problemas AS (
  -- 1. Mesmo vínculo, mesmo mês e mesmo vencimento lançado mais de uma vez
  SELECT 1 AS grav, 'Lançamento em dobro' AS verificacao, min(pessoa) AS pessoa, min(cliente) AS cliente,
         count(*) || ' lançamentos para ' || to_char(due_date, 'DD/MM') || ' (mês ' || coalesce(reference_month, '?') || ')' AS detalhe,
         sum(amount) AS valor
    FROM pg GROUP BY dono, reference_month, due_date HAVING count(*) > 1

  UNION ALL -- 2. Previsão ainda pendente junto com o fechamento (Real) do mesmo mês
  SELECT 1, 'Previsão e fechamento abertos juntos', min(e.pessoa), min(e.cliente),
         'A previsão de ' || e.reference_month || ' devia ter sido cancelada quando fecharam pelo realizado', sum(e.amount)
    FROM pg e
   WHERE e.type = 'Estimativa' AND e.status = 'Pendente'
     AND EXISTS (SELECT 1 FROM pg r WHERE r.dono = e.dono AND r.reference_month = e.reference_month AND r.type = 'Real')
   GROUP BY e.dono, e.reference_month

  UNION ALL -- 3. Consultoria por visita só paga dia 8 e 20
  SELECT 1, 'Consultoria fora do dia 8/20', p.pessoa, p.cliente,
         'Vence ' || to_char(p.due_date, 'DD/MM/YYYY') || ' — ' || coalesce(p.description, ''), p.amount
    FROM pg p JOIN employee_client_links l ON l.id = p.link_id
   WHERE l.service_type = 'Consultoria' AND coalesce(l.pay_mode, 'mensal') <> 'salario_fixo'
     AND extract(day FROM p.due_date) NOT IN (8, 20)

  UNION ALL -- 4. Consultoria: lançado MENOR que as visitas registradas (visita entrou depois do lançamento)
  SELECT 1, 'Consultoria lançada a menos', v.pessoa, v.cliente,
         'Mês ' || x.mes || ': visitas somam ' || to_char(x.visitas, 'FM999G990D00') || ', lançado ' || to_char(coalesce(x.lancado, 0), 'FM999G990D00'),
         x.visitas - coalesce(x.lancado, 0)
    FROM vinc v
    JOIN LATERAL (
      SELECT m.mes,
             (SELECT sum(coalesce(nv.visit_rate, 0)) FROM nutritionist_visits nv
               WHERE nv.employee_id = v.employee_id AND nv.client_id = v.client_id
                 AND to_char(nv.visit_date, 'YYYY-MM') = m.mes AND nv.check_out IS NOT NULL
                 AND NOT coalesce(nv.is_unavailable, false)) AS visitas,
             (SELECT sum(p.amount) FROM pg p WHERE p.link_id = v.id AND p.reference_month = m.mes) AS lancado
        FROM (SELECT mes_ant AS mes FROM jan UNION ALL SELECT mes_atu FROM jan) m
    ) x ON true
   WHERE v.por_visita AND coalesce(x.lancado, 0) > 0 AND x.visitas - coalesce(x.lancado, 0) >= 1

  UNION ALL -- 5. Marcado como pago sem data de pagamento
  SELECT 2, 'Pago sem data', pessoa, cliente, coalesce(description, ''), amount
    FROM pg WHERE status = 'Pago' AND paid_at IS NULL

  UNION ALL -- 6. Valor zero ou negativo
  SELECT 1, 'Lançamento com valor zero ou negativo', pessoa, cliente, coalesce(description, ''), amount
    FROM pg WHERE coalesce(amount, 0) <= 0

  UNION ALL -- 7. Salário lançado sem colaborador
  SELECT 2, 'Salário sem colaborador', NULL, cliente, coalesce(description, ''), amount
    FROM pg WHERE category = 'Salário' AND employee_id IS NULL

  UNION ALL -- 8. Fixo / salário sem dia de pagamento: o sistema usa o dia 5 e cai em "Avulsos"
  SELECT 1, 'Sem dia de pagamento', v.pessoa, v.cliente,
         'Vínculo ' || CASE WHEN v.service_type = 'Consultoria' THEN 'consultoria com salário' ELSE 'fixo' END || ' sem dia 8, 15 ou 20 marcado', NULL
    FROM vinc v
   WHERE NOT v.por_visita AND NOT coalesce(v.is_temporary, false)
     AND NOT EXISTS (SELECT 1 FROM employee_payment_dates d WHERE d.link_id = v.id)
     AND (v.service_type <> 'Consultoria' OR coalesce(v.monthly_amount, 0) > 0)

  UNION ALL -- 9. Dia de pagamento diferente de 8, 15 e 20
  SELECT 2, 'Dia de pagamento fora do padrão', v.pessoa, v.cliente, 'Dia ' || d.day_of_month || ' (esperado 8, 15 ou 20)', NULL
    FROM vinc v JOIN employee_payment_dates d ON d.link_id = v.id
   WHERE NOT v.por_visita AND d.day_of_month NOT IN (8, 15, 20)

  UNION ALL -- 10. Fixo sem salário (consultoria com salário: soma de todos os clientes da pessoa)
  SELECT 2, 'Sem salário no vínculo', min(v.pessoa), string_agg(DISTINCT v.cliente, ', '),
         CASE WHEN bool_and(v.service_type = 'Consultoria') THEN 'Consultoria com salário sem valor em nenhum cliente' ELSE 'Fixo sem salário' END, NULL
    FROM vinc v
   WHERE NOT v.por_visita AND NOT coalesce(v.is_temporary, false)
   GROUP BY v.employee_id, CASE WHEN v.service_type = 'Consultoria' THEN 'c' ELSE v.id::text END
  HAVING sum(coalesce(v.monthly_amount, 0)) = 0

  UNION ALL -- 11. Visita de consultoria por visita registrada sem valor (vai pagar R$ 0)
  SELECT 2, 'Visita sem valor', v.pessoa, v.cliente,
         count(*) || ' visita(s) sem valor: ' || string_agg(to_char(nv.visit_date, 'DD/MM'), ', ' ORDER BY nv.visit_date), NULL
    FROM vinc v
    JOIN nutritionist_visits nv ON nv.employee_id = v.employee_id AND nv.client_id = v.client_id, jan
   WHERE v.por_visita AND nv.visit_date BETWEEN jan.ini AND jan.fim
     AND nv.check_out IS NOT NULL AND NOT coalesce(nv.is_unavailable, false)
     AND coalesce(nv.visit_rate, 0) = 0
   GROUP BY v.id, v.pessoa, v.cliente

  UNION ALL -- 12. Pendente com vencimento já passado
  SELECT 3, 'Atrasado', pessoa, cliente,
         'Venceu ' || to_char(due_date, 'DD/MM/YYYY') || ' — ' || coalesce(description, ''), amount
    FROM pg WHERE status = 'Pendente' AND due_date < current_date
)
SELECT grav AS gravidade, verificacao, pessoa, cliente, detalhe,
       CASE WHEN valor IS NULL THEN '' ELSE 'R$ ' || to_char(valor, 'FM999G999G990D00') END AS valor
  FROM problemas
UNION ALL
SELECT 0, 'Tudo certo', NULL, NULL, 'Nenhum problema encontrado no mês atual e no anterior', ''
 WHERE NOT EXISTS (SELECT 1 FROM problemas)
ORDER BY 1, 2, 3;
