-- ============================================================
-- Migration 052 — O RH pode registrar a visita por quem esqueceu
-- ------------------------------------------------------------
-- O PROBLEMA
-- Só a colaboradora registra visita, pelo portal. Se ela esquece, fica sem
-- internet, ou trabalha num evento e não lança, o dia não existe para a folha:
-- aparece "0 visitas · R$ 0,00" e NINGUÉM consegue corrigir. Foi o caso da
-- Joana e da Anne no evento do GRSA Projetos.
--
-- Esta função deixa o RH lançar o dia que aconteceu. O valor NÃO é digitado:
-- sai da mesma portal_calc_visit_rate que o portal usa, para o registro do RH
-- e o da colaboradora nunca darem valores diferentes pelo mesmo trabalho.
--
-- Fica marcado quem lançou, em observations, para não virar caixa-preta.
-- ============================================================

CREATE OR REPLACE FUNCTION rh_registrar_visita(
  p_employee uuid,
  p_client   uuid,
  p_unit     uuid,
  p_date     date,
  p_in       time,
  p_out      time,
  p_b1       time DEFAULT NULL,
  p_b2       time DEFAULT NULL,
  p_obs      text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_id        uuid;
  v_rate      numeric;
  v_unit_name text;
  v_quem      text;
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Apenas usuários internos podem registrar visita' USING ERRCODE = '42501';
  END IF;

  IF p_in IS NULL OR p_out IS NULL THEN
    RAISE EXCEPTION 'Informe a hora de entrada e de saída';
  END IF;

  -- Mesmo dia, mesmo cliente, já registrado? Evita pagar duas vezes o mesmo dia
  IF EXISTS (
    SELECT 1 FROM nutritionist_visits
     WHERE employee_id = p_employee AND client_id = p_client AND visit_date = p_date
  ) THEN
    RAISE EXCEPTION 'Já existe visita registrada para esta pessoa neste cliente em %',
      to_char(p_date, 'DD/MM/YYYY');
  END IF;

  -- Valor pela MESMA regra do portal — nunca digitado à mão
  v_rate := portal_calc_visit_rate(p_employee, p_client, p_unit, p_date, p_in, p_out, p_b1, p_b2);

  SELECT name INTO v_unit_name FROM client_units WHERE id = p_unit;

  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.email', true), ''), 'RH')
    INTO v_quem;

  INSERT INTO nutritionist_visits (
    employee_id, client_id, unit_id, unit_name, visit_date,
    check_in, check_out, break_start, break_end, visit_rate, observations
  ) VALUES (
    p_employee, p_client, p_unit, v_unit_name, p_date,
    p_in, p_out, p_b1, p_b2, v_rate,
    COALESCE(NULLIF(btrim(coalesce(p_obs, '')), '') || ' · ', '')
      || 'Registrado pelo RH (' || v_quem || ')'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END$$;

GRANT EXECUTE ON FUNCTION rh_registrar_visita(uuid, uuid, uuid, date, time, time, time, time, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION rh_registrar_visita(uuid, uuid, uuid, date, time, time, time, time, text) FROM anon, public;

NOTIFY pgrst, 'reload schema';

SELECT 'rh_registrar_visita criada' AS resultado;
