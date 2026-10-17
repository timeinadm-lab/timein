-- ============================================================
-- AUDITORIA DOS VÍNCULOS (17/10/2026) — SÓ LEITURA, não muda nada.
-- Rode no projeto RH COMPLETO, DEPOIS da migração 098. Cada linha é um vínculo ATIVO (ou registro
-- recente) com algo que pode dar problema no portal, na Jornada ou no
-- pagamento. Resultado vazio = tudo redondo.
--   gravidade: 1 = afeta pagamento · 2 = afeta portal/Jornada · 3 = conferir
-- ============================================================
WITH l AS (
  SELECT l.*, e.full_name AS pessoa, c.name AS cliente,
         CASE WHEN l.service_type = 'Volante' THEN CASE WHEN l.coverage_type = 'Consultoria' THEN 'Consultoria' ELSE 'Fixo' END
              WHEN l.service_type = 'Consultoria' THEN 'Consultoria' ELSE 'Fixo' END AS tipo,
         (SELECT array_agg(d.day_of_month ORDER BY d.day_of_month) FROM employee_payment_dates d WHERE d.link_id = l.id) AS dias_pgto
    FROM employee_client_links l
    JOIN employees e ON e.id = l.employee_id
    LEFT JOIN clients c ON c.id = l.client_id
   WHERE e.status = 'Ativo'
     AND (l.contract_end_date IS NULL OR l.contract_end_date >= current_date)
     AND NOT l.so_acesso   -- só acesso (098): sem obrigação, fora da conferência de cadastro
),
-- formato de cada vínculo
f AS (
  SELECT l.*,
         CASE WHEN tipo = 'Consultoria' AND pay_mode = 'salario_fixo' THEN 'consultor fixo'
              WHEN tipo = 'Consultoria' THEN 'consultoria por visita'
              WHEN service_type = 'Volante' OR pay_mode = 'diaria' THEN 'fixo por diária'
              ELSE 'fixo mensal' END AS formato
    FROM l
),
problemas AS (
  -- ── PAGAMENTO ────────────────────────────────────────────────
  SELECT 1 g, pessoa, cliente, formato, 'Consultoria por visita sem valor: nem no vínculo nem nas unidades do cliente (visita sai R$ 0)' problema FROM f
   WHERE formato = 'consultoria por visita'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(link_units, '[]'::jsonb)) u WHERE coalesce((u->>'visit_rate')::numeric, 0) > 0)
     AND NOT EXISTS (SELECT 1 FROM client_units u WHERE u.client_id = f.client_id AND coalesce(u.visit_rate, 0) > 0)
  UNION ALL
  SELECT 1, pessoa, cliente, formato, 'Unidade "' || u.name || '" sem valor da visita: quem registrar nela fica sem valor' FROM f
    JOIN client_units u ON u.client_id = f.client_id AND coalesce(u.visit_rate, 0) = 0
   WHERE formato = 'consultoria por visita'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(f.link_units, '[]'::jsonb)) x WHERE x->>'unit_id' = u.id::text AND coalesce((x->>'visit_rate')::numeric, 0) > 0)
  UNION ALL
  SELECT 1, pessoa, string_agg(cliente, ', '), 'consultor fixo', 'Consultor fixo sem salário em nenhum dos clientes (sai R$ 0)' FROM f
   WHERE formato = 'consultor fixo' GROUP BY employee_id, pessoa HAVING coalesce(sum(monthly_amount), 0) = 0
  UNION ALL
  SELECT 1, pessoa, cliente, formato, 'Fixo por diária sem valor da diária (sai R$ 0)' FROM f
   WHERE formato = 'fixo por diária' AND coalesce(daily_rate, 0) = 0
  UNION ALL
  SELECT 1, pessoa, cliente, formato, 'Fixo mensal sem salário e sem datas combinadas (sai R$ 0)' FROM f
   WHERE formato = 'fixo mensal' AND coalesce(monthly_amount, 0) = 0 AND coalesce(jsonb_array_length(parcelas), 0) = 0
  UNION ALL
  SELECT 1, pessoa, cliente, formato, 'Sem dia de pagamento marcado (a folha usa dia 5 no chute)' FROM f
   WHERE formato = 'fixo mensal' AND dias_pgto IS NULL AND coalesce(jsonb_array_length(parcelas), 0) = 0
  UNION ALL
  SELECT 1, pessoa, string_agg(cliente, ', '), 'consultor fixo', 'Consultor fixo sem dia de pagamento em nenhum dos clientes' FROM f
   WHERE formato = 'consultor fixo' GROUP BY employee_id, pessoa HAVING bool_and(dias_pgto IS NULL)
  UNION ALL
  SELECT 1, pessoa, cliente, formato, 'Fixo com mais de um dia de pagamento: ' || array_to_string(dias_pgto, ' e ') || ' (fixo recebe uma vez só)' FROM f
   WHERE formato IN ('fixo mensal', 'fixo por diária') AND cardinality(dias_pgto) > 1
  UNION ALL
  SELECT 1, pessoa, cliente, formato, 'Dias de pagamento ' || array_to_string(dias_pgto, ' e ') || ' fora do padrão (um dia: 8, 15 ou 20 · dois: só 8 e 20)' FROM f
   WHERE dias_pgto IS NOT NULL AND NOT (dias_pgto IN (ARRAY[8], ARRAY[15], ARRAY[20]) OR (formato LIKE 'consult%' AND dias_pgto = ARRAY[8, 20]))
  UNION ALL
  SELECT 1, a.pessoa, a.cliente, a.formato, 'Dois vínculos fixos (não temporários) no mesmo cliente ao mesmo tempo: risco de pagar em dobro' FROM f a
    JOIN f b ON b.employee_id = a.employee_id AND b.client_id = a.client_id AND b.id > a.id
   WHERE NOT coalesce(a.is_temporary, false) AND a.service_type <> 'Volante'
     AND NOT coalesce(b.is_temporary, false) AND b.service_type <> 'Volante'
  UNION ALL
  SELECT 1, pessoa, cliente, formato, 'Data de início depois do fim do contrato' FROM f
   WHERE start_date IS NOT NULL AND contract_end_date IS NOT NULL AND start_date > contract_end_date

  -- ── PORTAL E JORNADA ─────────────────────────────────────────
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Sem escala definida (a folha estima 22 dias e o portal não mostra os dias)' FROM f
   WHERE formato = 'fixo mensal' AND coalesce(work_schedule_type, '') = ''
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Escala ' || work_schedule_type || ' sem dias de folga marcados (portal não mostra os dias, Jornada não acha faltas)' FROM f
   WHERE tipo = 'Fixo' AND work_schedule_type IN ('5x2', '6x1') AND coalesce(cardinality(days_off), 0) = 0
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Escala ' || work_schedule_type || ' com ' || cardinality(days_off) || ' folga(s) na semana (esperado ' || CASE work_schedule_type WHEN '5x2' THEN '2' ELSE '1' END || ')' FROM f
   WHERE tipo = 'Fixo' AND work_schedule_type IN ('5x2', '6x1') AND cardinality(days_off) > 0
     AND cardinality(days_off) <> CASE work_schedule_type WHEN '5x2' THEN 2 ELSE 1 END
  UNION ALL
  SELECT 2, pessoa, cliente, formato, '12x36 sem a data do primeiro plantão (portal não sabe os dias)' FROM f
   WHERE tipo = 'Fixo' AND work_schedule_type = '12x36' AND schedule_anchor_date IS NULL
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Horas na semana sem a quantidade de horas (Jornada não confere)' FROM f
   WHERE tipo = 'Fixo' AND work_schedule_type = 'horas' AND coalesce(horas_semana, 0) = 0
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Sem horas por dia nem horário (a jornada do dia não é conferida)' FROM f
   WHERE formato = 'fixo mensal' AND coalesce(work_schedule_type, '') NOT IN ('horas', 'cliente')
     AND coalesce(daily_hours, 0) = 0 AND (work_start IS NULL OR work_end IS NULL)
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Temporário sem data de fim' FROM f
   WHERE (coalesce(is_temporary, false) OR service_type = 'Volante') AND contract_end_date IS NULL
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Agenda montada pelo RH, mas nada na agenda de ' || to_char(current_date, 'MM/YYYY') || ' (ela não vê aonde ir)' FROM f
   WHERE tipo = 'Consultoria' AND agenda_mode = 'gestor'
     AND NOT EXISTS (SELECT 1 FROM nutritionist_agenda a WHERE a.employee_id = f.employee_id AND a.client_id = f.client_id
                      AND date_trunc('month', a.planned_date) = date_trunc('month', current_date))
  UNION ALL
  SELECT 2, pessoa, cliente, formato, 'Cliente sem nenhuma unidade cadastrada (no portal ela não escolhe unidade)' FROM f
   WHERE formato = 'consultoria por visita'
     AND NOT EXISTS (SELECT 1 FROM client_units u WHERE u.client_id = f.client_id)
     AND coalesce(jsonb_array_length(link_units), 0) = 0

  -- ── REGISTROS DOS ÚLTIMOS 2 MESES ────────────────────────────
  UNION ALL
  SELECT 1, e.full_name, c.name, 'consultoria por visita', 'Visita de ' || to_char(v.visit_date, 'DD/MM') || ' sem valor (vai sair R$ 0 — Pagamentos → recalcular)' FROM nutritionist_visits v
    JOIN employees e ON e.id = v.employee_id LEFT JOIN clients c ON c.id = v.client_id
   WHERE v.visit_date >= date_trunc('month', current_date) - interval '1 month'
     AND v.check_in IS NOT NULL AND v.check_out IS NOT NULL
     AND NOT coalesce(v.is_unavailable, false) AND NOT coalesce(v.is_holiday, false)
     AND coalesce(v.visit_rate, 0) = 0 AND coalesce(v.extra_approval, '') NOT IN ('pendente', 'negada')
     AND EXISTS (SELECT 1 FROM employee_client_links k WHERE k.employee_id = v.employee_id AND k.client_id = v.client_id
                  AND k.service_type = 'Consultoria' AND coalesce(k.pay_mode, '') <> 'salario_fixo'
                  AND (k.start_date IS NULL OR v.visit_date >= k.start_date)
                  AND (k.contract_end_date IS NULL OR v.visit_date <= k.contract_end_date))
  UNION ALL
  SELECT 3, e.full_name, c.name, '—', 'Registro de ' || to_char(v.visit_date, 'DD/MM') || ' fora do período de qualquer vínculo com esse cliente (não entra em lugar nenhum)' FROM nutritionist_visits v
    JOIN employees e ON e.id = v.employee_id LEFT JOIN clients c ON c.id = v.client_id
   WHERE v.visit_date >= date_trunc('month', current_date) - interval '1 month'
     AND NOT EXISTS (SELECT 1 FROM employee_client_links k WHERE k.employee_id = v.employee_id AND k.client_id = v.client_id
                      AND (k.start_date IS NULL OR v.visit_date >= k.start_date)
                      AND (k.contract_end_date IS NULL OR v.visit_date <= k.contract_end_date))
  UNION ALL
  SELECT 3, e.full_name, c.name, '—', 'Registro de ' || to_char(v.visit_date, 'DD/MM') || ' com entrada e sem saída' FROM nutritionist_visits v
    JOIN employees e ON e.id = v.employee_id LEFT JOIN clients c ON c.id = v.client_id
   WHERE v.visit_date >= date_trunc('month', current_date) - interval '1 month' AND v.visit_date < current_date
     AND v.check_in IS NOT NULL AND v.check_out IS NULL AND NOT coalesce(v.is_unavailable, false)
)
SELECT g AS gravidade, pessoa, cliente, formato, problema
  FROM problemas
 ORDER BY g, pessoa, cliente;

-- Resumo: quantos vínculos ativos de cada formato (para conferir se bate com o que você espera)
-- SELECT formato, count(*) FROM (...) — rode separado se quiser:
-- SELECT CASE WHEN service_type='Consultoria' AND pay_mode='salario_fixo' THEN 'consultor fixo'
--             WHEN service_type='Consultoria' THEN 'consultoria por visita'
--             WHEN service_type='Volante' OR pay_mode='diaria' THEN 'fixo por diária' ELSE 'fixo mensal' END formato,
--        coalesce(work_schedule_type,'(sem)') escala, count(*)
--   FROM employee_client_links l JOIN employees e ON e.id=l.employee_id
--  WHERE e.status='Ativo' AND (contract_end_date IS NULL OR contract_end_date >= current_date)
--  GROUP BY 1,2 ORDER BY 1,2;
