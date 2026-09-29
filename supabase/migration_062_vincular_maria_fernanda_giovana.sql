-- ============================================================
-- 062 — Vincular Maria Fernanda e Giovana de Jesus em TODOS os clientes
-- ------------------------------------------------------------
-- Pedido do Gabriel (29/09/2026): as duas atendem todos os clientes.
-- Tipo: Consultoria com salário fixo (fixo de consultoria / agente de qualidade),
-- SEM valor — o RH preenche o salário depois, editando o vínculo.
-- Sem cobrança de contrato. Início: hoje.
-- Cliente em que ela já tem vínculo valendo é pulado (não duplica).
-- Se não achar a pessoa (ou achar mais de uma), para tudo e não grava nada.
-- ============================================================

DO $$
DECLARE
  v_nome  text;
  v_ids   uuid[];
  v_emp   uuid;
  v_n     int;
  r       text := E'\n';
BEGIN
  FOREACH v_nome IN ARRAY ARRAY['maria fernanda brandao santos', 'giovana de jesus oliveira'] LOOP
    SELECT array_agg(id) INTO v_ids FROM employees
     WHERE lower(translate(full_name, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
           LIKE v_nome || '%';
    -- Maria Fernanda tem 2 cadastros com o mesmo CPF: vale o de 07/07 (já tem o
    -- vínculo GRSA Auditoria). O de 05/08, sem vínculo, é o repetido.
    IF v_nome = 'maria fernanda brandao santos' THEN
      v_ids := ARRAY['b8a03ce7-31a2-4407-89dc-09b73ae695a8'::uuid];
    END IF;
    IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Não achei "%" no cadastro. Nada foi gravado.', v_nome;
    ELSIF array_length(v_ids, 1) > 1 THEN
      RAISE EXCEPTION 'Achei % cadastros para "%". Nada foi gravado — me avise.', array_length(v_ids, 1), v_nome;
    END IF;
    v_emp := v_ids[1];

    INSERT INTO employee_client_links (
      employee_id, client_id, service_type, coverage_type, is_temporary, pay_mode,
      agenda_mode, contract_required, start_date, monthly_amount, visit_frequency
    )
    SELECT v_emp, c.id, 'Consultoria', 'Consultoria', false, 'salario_fixo',
           'colaborador', false, (now() AT TIME ZONE 'America/Sao_Paulo')::date, NULL, 'Avulso'
      FROM clients c
     WHERE NOT EXISTS (
       SELECT 1 FROM employee_client_links l
        WHERE l.employee_id = v_emp AND l.client_id = c.id
          AND (l.contract_end_date IS NULL OR l.contract_end_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
     );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || v_nome || ': ' || v_n || E' vínculo(s) novo(s)\n';
  END LOOP;
  RAISE NOTICE 'Pronto:%', r;
END$$;

-- Conferência: quantos clientes cada uma tem agora
SELECT e.full_name, count(*) AS clientes
  FROM employee_client_links l JOIN employees e ON e.id = l.employee_id
 WHERE (lower(e.full_name) LIKE 'maria fernanda%' OR lower(e.full_name) LIKE 'giovana de jesus%')
   AND (l.contract_end_date IS NULL OR l.contract_end_date >= current_date)
 GROUP BY e.full_name;
