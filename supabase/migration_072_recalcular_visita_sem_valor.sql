-- ============================================================
-- Migration 072 — Visita registrada SEM VALOR pode ser recalculada pelo RH
-- ------------------------------------------------------------
-- Achado na conferência de pagamentos (30/09/2026): visita de consultoria
-- registrada quando o cliente/unidade ainda não tinha preço por visita fica
-- com valor vazio para sempre — e o pagamento sai sem ela, sem aviso.
--
-- Agora: o RH coloca o preço na unidade do cliente (ou no vínculo) e, em
-- Pagamentos, clica "Recalcular". A conta é a MESMA do portal
-- (portal_calc_visit_rate: preço da unidade, proporcional às horas
-- combinadas por visita).
--
-- Só mexe em visita SEM valor. Nunca muda visita que já tem valor, nem
-- extra aguardando aprovação ou negado, nem falta/folga.
-- Visita sem unidade: se o cliente tem UMA só unidade com preço, usa ela.
-- ============================================================

CREATE OR REPLACE FUNCTION rh_recalcular_visitas_sem_valor(
  p_employee uuid, p_client uuid, p_ini date, p_fim date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        record;
  v_unit   uuid;
  v_valor  numeric;
  v_ok     int := 0;
  v_sem    int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'Só o RH logado pode recalcular.' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT * FROM nutritionist_visits v
     WHERE v.employee_id = p_employee AND v.client_id = p_client
       AND v.visit_date BETWEEN p_ini AND p_fim
       AND coalesce(v.visit_rate, 0) = 0
       AND v.check_in IS NOT NULL AND v.check_out IS NOT NULL
       AND NOT coalesce(v.is_unavailable, false)
       AND NOT coalesce(v.is_holiday, false)
       AND v.extra_approval IS DISTINCT FROM 'pendente'
       AND v.extra_approval IS DISTINCT FROM 'negada'
  LOOP
    v_unit := coalesce(r.unit_id, (
      SELECT min(u.id::text)::uuid FROM client_units u
       WHERE u.client_id = r.client_id AND coalesce(u.visit_rate, 0) > 0
      HAVING count(*) = 1));

    v_valor := portal_calc_visit_rate(
      r.employee_id, r.client_id, v_unit, r.visit_date,
      r.check_in::time, r.check_out::time,
      nullif(btrim(coalesce(r.break_start::text, '')), '')::time,
      nullif(btrim(coalesce(r.break_end::text, '')), '')::time);

    IF coalesce(v_valor, 0) > 0 THEN
      UPDATE nutritionist_visits SET visit_rate = v_valor WHERE id = r.id;
      v_ok := v_ok + 1;
    ELSE
      v_sem := v_sem + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('corrigidas', v_ok, 'sem_preco', v_sem);
END$$;

REVOKE ALL ON FUNCTION rh_recalcular_visitas_sem_valor(uuid, uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION rh_recalcular_visitas_sem_valor(uuid, uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve aparecer 1 linha com a função
SELECT proname AS funcao FROM pg_proc WHERE proname = 'rh_recalcular_visitas_sem_valor';
