-- ============================================================
-- Migration 056 — Portal: agenda do mês inteiro (inclui dias que já passaram)
-- ------------------------------------------------------------
-- SINTOMA: o RH marca um dia na agenda da nutricionista (ex.: 18/09) e ele
-- não aparece no portal dela.
--
-- CAUSA: a agenda do portal (portal_base) só traz dias de HOJE em diante.
-- Dia combinado que já passou sem registro some — justamente o que ela
-- precisa ver para registrar ou avisar.
--
-- CORREÇÃO: função nova que devolve a agenda do mês que está na tela, com
-- os dias passados. portal_base não é alterada.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_agenda(p_token text, p_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  uid     uuid := portal_uid(p_token);
  d_start date := (p_month || '-01')::date;
  d_end   date := ((p_month || '-01')::date + interval '1 month - 1 day')::date;
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
              'client', (SELECT jsonb_build_object('name', c.name) FROM clients c WHERE c.id = a.client_id),
              'unit',   (SELECT jsonb_build_object('name', cu.name) FROM client_units cu WHERE cu.id = a.unit_id)
            ) ORDER BY a.planned_date), '[]'::jsonb)
      FROM nutritionist_agenda a
     WHERE a.employee_id = uid
       AND a.planned_date BETWEEN d_start AND d_end
  );
END$$;

GRANT EXECUTE ON FUNCTION portal_agenda(text, text) TO anon;

NOTIFY pgrst, 'reload schema';
