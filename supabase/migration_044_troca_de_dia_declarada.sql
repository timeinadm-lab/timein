-- ============================================================
-- Migration 044 — Troca de dia declarada no registro da visita
-- ------------------------------------------------------------
-- Situação real: o RH monta a agenda dela pro dia 20. Ela não consegue no
-- 20 e vai no 21. Hoje:
--   • ela não pode remarcar (o dia é fixado pelo RH — e isso está certo)
--   • ela registra o ponto no 21 e o dia 20 fica em aberto
--   • o painel acusa "não apareceu no dia 20" sem saber que ela foi no 21
--
-- portal_reschedule_agenda continua BLOQUEANDO alteração solta de dia
-- fixado pelo RH — ela não muda a agenda por conta própria.
--
-- Esta função é outra coisa: ela é chamada no momento em que a visita é
-- registrada, para DECLARAR que aquele dia substituiu o combinado. Não é
-- pedido, é fato consumado — e fica marcado (original_date + rescheduled_at)
-- para o RH ver no painel que houve troca.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_trocar_dia_agenda(p_token text, p_id uuid, p_nova_data date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  UPDATE nutritionist_agenda
     SET original_date  = COALESCE(original_date, planned_date),  -- guarda o combinado
         planned_date   = p_nova_data,
         rescheduled_at = now()
   WHERE id = p_id AND employee_id = uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado' USING ERRCODE = '42501';
  END IF;
END$$;

GRANT EXECUTE ON FUNCTION portal_trocar_dia_agenda(text, uuid, date) TO anon;

NOTIFY pgrst, 'reload schema';
