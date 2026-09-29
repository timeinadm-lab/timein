-- ============================================================
-- Migration 061 — Registrar visita travava para quem tem cota de horas no mês
-- ------------------------------------------------------------
-- Achado no teste do portal (29/09/2026): ao registrar, portal_save_visit
-- soma as horas do mês para ver se passou da cota. As colunas de intervalo
-- (break_start / break_end) da tabela de visitas são TEXTO, e a conta de horas
-- só aceitava HORÁRIO:
--   function portal_horas_liquidas(time, time, text, text) does not exist
-- Resultado: quem tem "horas/mês" no vínculo não conseguia registrar visita.
--
-- Correção: uma versão da conta que aceita o intervalo em texto e converte.
-- Não mexe na função de registrar nem em dado nenhum.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_horas_liquidas(p_in time, p_out time, p_b1 text, p_b2 text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT portal_horas_liquidas(
    p_in, p_out,
    nullif(btrim(coalesce(p_b1, '')), '')::time,
    nullif(btrim(coalesce(p_b2, '')), '')::time
  )
$$;

NOTIFY pgrst, 'reload schema';

-- Conferência: 8h às 17h com 1h de intervalo = 8 horas
SELECT portal_horas_liquidas('08:00'::time, '17:00'::time, '12:00'::text, '13:00'::text) AS deve_dar_8;
