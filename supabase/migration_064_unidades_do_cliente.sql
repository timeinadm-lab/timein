-- ============================================================
-- Migration 064 — Unidades do cliente: sem duplicadas e com o valor da visita
-- ------------------------------------------------------------
-- Pedido do Gabriel (29/09/2026):
--   · A pessoa é vinculada ao CLIENTE; a unidade ela escolhe no portal ao
--     registrar. O valor da visita de cada unidade fica no cadastro do
--     cliente (client_units.visit_rate).
--   · No GRSA Auditoria apareciam os estados repetidos (3× São Paulo...).
--
-- Causa das repetidas: editar o cliente apagava todas as unidades e criava
-- de novo. Quando a unidade já tinha visita/agenda ligada o apagar falhava
-- sem aviso e as unidades eram criadas outra vez → uma cópia a cada edição.
-- (O formulário do cliente foi corrigido junto com esta migração.)
--
-- O que esta migração faz:
--   1) Junta as unidades repetidas (mesmo cliente + mesmo nome): fica a mais
--      antiga, com o maior valor de visita do grupo; tudo que apontava para
--      as cópias (visitas, agenda, vínculos, vagas, supervisões) passa a
--      apontar para ela; as cópias são apagadas.
--   2) Valor da visita: continua valendo o valor combinado no vínculo quando
--      existir (quem já tem valor próprio não muda). Sem ele, passa a valer o
--      valor da unidade no cadastro do cliente. Hoje esses casos davam R$ 0.
-- ============================================================

-- ── 1. Unidades repetidas ────────────────────────────────────────────────
DROP TABLE IF EXISTS pg_temp.unidade_dup;
CREATE TEMP TABLE unidade_dup AS
WITH grupos AS (
  SELECT client_id, lower(btrim(name)) AS nome,
         (array_agg(id ORDER BY created_at, id))[1] AS fica,
         max(coalesce(visit_rate, 0)) AS maior_valor
    FROM client_units
   GROUP BY client_id, lower(btrim(name))
  HAVING count(*) > 1
)
SELECT u.id AS sai, g.fica, g.maior_valor
  FROM client_units u
  JOIN grupos g ON g.client_id = u.client_id AND lower(btrim(u.name)) = g.nome
 WHERE u.id <> g.fica;

-- Antes: quantas cópias serão juntadas
SELECT count(*) AS copias_de_unidade, count(DISTINCT fica) AS unidades_que_ficam FROM unidade_dup;

DO $$
DECLARE col record; t text;
BEGIN
  -- Toda coluna uuid terminada em unit_id (unit_id, original_unit_id...) em qualquer tabela
  FOR col IN
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name LIKE '%unit_id'
       AND table_name <> 'client_units'
  LOOP
    EXECUTE format('UPDATE public.%I x SET %I = d.fica FROM unidade_dup d WHERE x.%I = d.sai',
                   col.table_name, col.column_name, col.column_name);
  END LOOP;

  -- Listas de unidades dentro de vínculos e vagas (jsonb com unit_id)
  FOREACH t IN ARRAY ARRAY['employee_client_links:link_units', 'vacancies:vacancy_units'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = split_part(t, ':', 1) AND column_name = split_part(t, ':', 2)) THEN
      EXECUTE format($q$
        UPDATE public.%1$I x SET %2$I = (
          SELECT jsonb_agg(elem) FROM (
            SELECT DISTINCT ON (coalesce(d.fica::text, e->>'unit_id'))
                   CASE WHEN d.fica IS NULL THEN e ELSE jsonb_set(e, '{unit_id}', to_jsonb(d.fica::text)) END AS elem
              FROM jsonb_array_elements(x.%2$I) e
              LEFT JOIN unidade_dup d ON d.sai::text = e->>'unit_id'
             ORDER BY coalesce(d.fica::text, e->>'unit_id'), (e->>'visit_rate')::numeric DESC NULLS LAST
          ) s)
        WHERE jsonb_typeof(x.%2$I) = 'array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(x.%2$I) e JOIN unidade_dup d ON d.sai::text = e->>'unit_id')
      $q$, split_part(t, ':', 1), split_part(t, ':', 2));
    END IF;
  END LOOP;
END$$;

UPDATE client_units u SET visit_rate = d.maior_valor
  FROM (SELECT DISTINCT fica, maior_valor FROM unidade_dup) d
 WHERE u.id = d.fica AND coalesce(u.visit_rate, 0) < d.maior_valor;

DELETE FROM client_units u USING unidade_dup d WHERE u.id = d.sai;

-- ── 2. Valor da visita: vínculo, senão cadastro do cliente ──────────────
CREATE OR REPLACE FUNCTION valor_da_unidade(p_link employee_client_links, p_unit uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT nullif((elem->>'visit_rate')::numeric, 0)
       FROM jsonb_array_elements(coalesce(p_link.link_units, '[]'::jsonb)) elem
      WHERE (elem->>'unit_id')::uuid = p_unit LIMIT 1),
    (SELECT nullif(u.visit_rate, 0) FROM client_units u
      WHERE u.id = p_unit AND u.client_id = p_link.client_id)
  )
$$;

CREATE OR REPLACE FUNCTION portal_calc_visit_rate(
  p_uid uuid, p_client uuid, p_unit uuid, p_date date,
  p_in time, p_out time, p_b1 time, p_b2 time
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link       employee_client_links%ROWTYPE;
  v_unit_rate  numeric;
  v_quota      numeric;
  v_horas      numeric;
  v_fator      numeric;
BEGIN
  SELECT * INTO v_link FROM employee_client_links
   WHERE employee_id = p_uid AND client_id = p_client
     AND (start_date IS NULL OR p_date >= start_date)
     AND (contract_end_date IS NULL OR p_date <= contract_end_date)
   ORDER BY (is_temporary OR service_type = 'Volante') DESC, start_date DESC NULLS LAST
   LIMIT 1;

  IF v_link.id IS NULL THEN
    SELECT * INTO v_link FROM employee_client_links
     WHERE employee_id = p_uid AND client_id = p_client
     ORDER BY (is_temporary OR service_type = 'Volante') ASC, start_date DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_link.id IS NULL THEN RETURN NULL; END IF;

  -- Fixo (mensal/diária) e consultoria com salário fixo: a folha paga pelo salário
  IF v_link.pay_mode = 'salario_fixo' THEN RETURN NULL; END IF;
  IF COALESCE(v_link.coverage_type, v_link.service_type) = 'Fixo'
     AND v_link.service_type <> 'Consultoria' THEN
    RETURN NULL;
  END IF;

  -- Valor combinado no vínculo; sem ele, o valor da unidade no cadastro do cliente
  v_unit_rate := valor_da_unidade(v_link, p_unit);
  IF v_unit_rate IS NULL OR v_unit_rate <= 0 THEN RETURN NULL; END IF;

  v_quota := v_link.weekly_hours_quota;
  IF v_quota IS NULL OR v_quota <= 0 THEN RETURN ROUND(v_unit_rate, 2); END IF;

  v_horas := portal_horas_liquidas(p_in, p_out, p_b1, p_b2);
  IF v_horas <= 0 THEN RETURN NULL; END IF;

  v_fator := LEAST(1, v_horas / v_quota);
  RETURN ROUND(v_unit_rate * v_fator, 2);
END$$;

-- Hora a mais (migração 062) usa a mesma regra de valor. Só roda se a 062 já existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'visita_excesso') THEN
    EXECUTE $f$
    CREATE OR REPLACE FUNCTION visita_excesso(
      p_emp uuid, p_client uuid, p_unit uuid, p_date date,
      p_in text, p_out text, p_b1 text, p_b2 text
    ) RETURNS TABLE (minutos integer, sugerido numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $b$
    DECLARE
      v_link  employee_client_links%ROWTYPE;
      v_in    time := nullif(btrim(coalesce(p_in, '')), '')::time;
      v_out   time := nullif(btrim(coalesce(p_out, '')), '')::time;
      v_b1    time := nullif(btrim(coalesce(p_b1, '')), '')::time;
      v_b2    time := nullif(btrim(coalesce(p_b2, '')), '')::time;
      v_min   numeric;
      v_exc   numeric;
      v_rate  numeric;
    BEGIN
      IF v_in IS NULL OR v_out IS NULL THEN RETURN; END IF;
      SELECT * INTO v_link FROM employee_client_links
       WHERE employee_id = p_emp AND client_id = p_client
         AND (start_date IS NULL OR p_date >= start_date)
         AND (contract_end_date IS NULL OR p_date <= contract_end_date)
       ORDER BY (is_temporary OR service_type = 'Volante') DESC, start_date DESC NULLS LAST
       LIMIT 1;
      IF v_link.id IS NULL
         OR COALESCE(v_link.coverage_type, v_link.service_type) <> 'Consultoria'
         OR v_link.pay_mode = 'salario_fixo'
         OR COALESCE(v_link.weekly_hours_quota, 0) <= 0 THEN
        RETURN;
      END IF;
      v_min := EXTRACT(EPOCH FROM (v_out - v_in)) / 60;
      IF v_min < 0 THEN v_min := v_min + 1440; END IF;
      IF v_b1 IS NOT NULL AND v_b2 IS NOT NULL THEN
        v_min := v_min - GREATEST(0, EXTRACT(EPOCH FROM (v_b2 - v_b1)) / 60);
      END IF;
      v_exc := v_min - v_link.weekly_hours_quota * 60;
      IF v_exc <= 0 THEN RETURN; END IF;
      v_rate := valor_da_unidade(v_link, p_unit);
      minutos := round(v_exc);
      sugerido := CASE WHEN v_rate > 0 THEN round(v_rate / (v_link.weekly_hours_quota * 60) * v_exc, 2) END;
      RETURN NEXT;
    END$b$;
    $f$;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Depois: não pode sobrar unidade repetida
SELECT count(*) AS unidades_repetidas_restantes FROM (
  SELECT 1 FROM client_units GROUP BY client_id, lower(btrim(name)) HAVING count(*) > 1
) x;
