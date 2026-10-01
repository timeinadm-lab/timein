-- ============================================================
-- 071 — Diego, Luciana Machado, Francislene e Graziele em TODOS os clientes
-- ------------------------------------------------------------
-- Pedido do Gabriel (30/09/2026): os quatro fazem consultoria em todos os
-- clientes. O RH monta a agenda deles. Horas são opcionais (não há carga
-- horária a cumprir); no portal registram entrada e saída se quiserem.
--
-- Vínculo: Consultoria (por visita), frequência "Em aberto", sem horas,
-- sem valor (o RH coloca depois), agenda montada pelo RH, sem cobrança de
-- contrato. Início: hoje.
-- Cliente em que a pessoa já tem vínculo valendo é pulado (não duplica).
-- Se um nome não achar ninguém, ou achar mais de um, PARA e não grava nada —
-- a mensagem lista quem foi encontrado.
-- ============================================================

DO $$
DECLARE
  v_padrao text;
  v_ids    uuid[];
  v_nomes  text;
  v_emp    uuid;
  v_n      int;
  r        text := E'\n';
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  FOREACH v_padrao IN ARRAY ARRAY['diego%', 'luciana%machado%', 'francislene%', 'graziel%'] LOOP
    SELECT array_agg(id), string_agg(full_name || ' (' || status || ')', ', ')
      INTO v_ids, v_nomes
      FROM employees
     WHERE status = 'Ativo'
       AND lower(translate(full_name, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
           LIKE v_padrao;
    IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Não achei ninguém ativo para "%". Nada foi gravado.', v_padrao;
    ELSIF array_length(v_ids, 1) > 1 THEN
      RAISE EXCEPTION 'Achei mais de um para "%": %. Nada foi gravado — me avise qual é.', v_padrao, v_nomes;
    END IF;
    v_emp := v_ids[1];

    INSERT INTO employee_client_links (
      employee_id, client_id, service_type, coverage_type, is_temporary, pay_mode,
      agenda_mode, contract_required, start_date, visit_frequency
    )
    SELECT v_emp, c.id, 'Consultoria', 'Consultoria', false, 'mensal',
           'gestor', false, v_hoje, 'Avulso'
      FROM clients c
     WHERE NOT EXISTS (
       SELECT 1 FROM employee_client_links l
        WHERE l.employee_id = v_emp AND l.client_id = c.id
          AND (l.contract_end_date IS NULL OR l.contract_end_date >= v_hoje)
     );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || v_nomes || ': ' || v_n || E' vínculo(s) novo(s)\n';
  END LOOP;
  RAISE NOTICE 'Pronto:%', r;
END$$;

-- Conferência: quantos clientes cada um tem agora (e quantos clientes existem)
SELECT e.full_name, count(l.id) AS clientes, (SELECT count(*) FROM clients) AS total_de_clientes
  FROM employees e
  LEFT JOIN employee_client_links l ON l.employee_id = e.id
       AND (l.contract_end_date IS NULL OR l.contract_end_date >= current_date)
 WHERE e.status = 'Ativo'
   AND (lower(e.full_name) LIKE 'diego%' OR lower(e.full_name) LIKE 'luciana%machado%'
        OR lower(e.full_name) LIKE 'francislene%' OR lower(e.full_name) LIKE 'graziel%')
 GROUP BY e.id, e.full_name;
