-- ============================================================
-- Migration 103 — Checklist (MELI e os outros): pergunta sem resposta conta
-- como erro
-- ------------------------------------------------------------
-- Pedido do Gabriel (22/10/2026): "se não responde, fica sem responder, conta
-- como erro; a porcentagem é proporcional à quantidade de perguntas que tem".
-- Nota = peso das conformes ÷ peso de TODAS as perguntas, menos as N/A.
-- Antes a sem resposta saía da conta e o portal nem deixava finalizar; agora
-- deixa, e ela entra como não conforme. Foto obrigatória continua exigida.
-- Só troca a função do portal (o escritório calcula na tela). As auditorias
-- já finalizadas não mudam (antes não dava para finalizar com pergunta em branco).
-- Pode rodar mais de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_auditoria_finalizar(p_token text, p_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token); v_foto int; v_ok numeric; v_tot numeric; v_nota numeric;
BEGIN
  PERFORM portal_auditoria_dela(uid, p_id, true);
  SELECT count(*) FILTER (WHERE foto_obrigatoria AND resposta IN ('C', 'NC') AND coalesce(array_length(fotos, 1), 0) = 0),
         coalesce(sum(peso) FILTER (WHERE resposta = 'C'), 0),
         coalesce(sum(peso) FILTER (WHERE resposta IS DISTINCT FROM 'NA'), 0)   -- sem resposta entra (= erro)
    INTO v_foto, v_ok, v_tot
    FROM auditoria_respostas WHERE auditoria_id = p_id;
  IF v_foto > 0 THEN RAISE EXCEPTION 'Falta foto em % pergunta(s) com foto obrigatória.', v_foto; END IF;
  v_nota := CASE WHEN v_tot > 0 THEN round(100 * v_ok / v_tot, 1) END;
  UPDATE auditorias SET status = 'finalizada', nota = v_nota, finalizada_em = now(),
         fim = coalesce(fim, (now() AT TIME ZONE 'America/Sao_Paulo')::time(0))
   WHERE id = p_id;
  RETURN v_nota;
END$$;

GRANT EXECUTE ON FUNCTION portal_auditoria_finalizar(text, uuid) TO anon;

NOTIFY pgrst, 'reload schema';

-- Conferência (esperado: true — a função nova já conta a sem resposta)
SELECT prosrc LIKE '%IS DISTINCT FROM ''NA''%' AS sem_resposta_conta_erro
  FROM pg_proc WHERE proname = 'portal_auditoria_finalizar';
