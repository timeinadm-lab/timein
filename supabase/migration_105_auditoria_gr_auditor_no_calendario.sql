-- ============================================================
-- Migration 105 — Auditoria GR: auditor escolhido entre os colaboradores e
-- a auditoria no calendário dele (escritório e portal)
-- ------------------------------------------------------------
-- Pedido do Gabriel (26/10/2026): "no auditor, eu escolho uma nutricionista
-- que a gente já tem vinculada (ex.: a Tatiane) e gera no calendário dela o
-- dia e o horário; se for alterado, troca também".
-- - auditor_id: quem faz a auditoria (colaborador). O nome continua em
--   "auditor" (texto), para quem é de fora.
-- - O calendário NÃO ganha uma cópia: lê direto da ficha. Mudou a data, o
--   horário ou o auditor na ficha, muda no calendário na hora.
-- - Nada vai para nutritionist_agenda: os dias da agenda entram na previsão
--   de pagamento e nas cobranças de registro do portal. A auditoria é paga
--   pela própria Auditoria GR (valor do auditor).
-- - portal_auditorias_gr: a agenda do portal mostra as auditorias da pessoa
--   no mês (fornecedor, dia, horário, endereço e contato; sem valores).
-- - Liga sozinho as fichas que já têm o nome do auditor, quando o nome bate
--   com UMA colaboradora não inativa só (ex.: "Tatiane").
-- Precisa da 087. Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE auditorias_fornecedores ADD COLUMN IF NOT EXISTS auditor_id uuid REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS aud_forn_auditor_data ON auditorias_fornecedores (auditor_id, agendada_para);

-- Fichas que já têm o nome: liga quando só uma colaboradora começa com esse nome
UPDATE auditorias_fornecedores a
   SET auditor_id = e.id
  FROM employees e
 WHERE a.auditor_id IS NULL
   AND nullif(trim(a.auditor), '') IS NOT NULL
   AND coalesce(e.status, '') <> 'Inativo'
   AND lower(e.full_name) LIKE lower(trim(a.auditor)) || '%'
   AND (SELECT count(*) FROM employees e2
         WHERE coalesce(e2.status, '') <> 'Inativo'
           AND lower(e2.full_name) LIKE lower(trim(a.auditor)) || '%') = 1;

-- Agenda do portal: as auditorias da pessoa no mês
CREATE OR REPLACE FUNCTION portal_auditorias_gr(p_token text, p_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  uid     uuid := portal_uid(p_token);
  d_start date := (p_month || '-01')::date;
  d_end   date := ((p_month || '-01')::date + interval '1 month - 1 day')::date;
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', a.id, 'fornecedor', a.fornecedor, 'planta', a.planta,
              'data', a.agendada_para, 'horario', a.horario, 'realizada_em', a.realizada_em,
              'endereco', a.endereco, 'cidade', a.cidade, 'uf', a.uf, 'local', a.local_auditoria,
              'contato', a.contato, 'telefone', a.telefone, 'produtos', a.produtos, 'status', a.status
            ) ORDER BY a.agendada_para, a.horario), '[]'::jsonb)
      FROM auditorias_fornecedores a
     WHERE a.auditor_id = uid
       AND a.agendada_para BETWEEN d_start AND d_end
       AND a.status NOT IN ('Cancelada', 'Encerrada – outro prestador', 'Encerrada – auditoria vigente')
  );
END$$;

GRANT EXECUTE ON FUNCTION portal_auditorias_gr(text, text) TO anon;

NOTIFY pgrst, 'reload schema';

-- Conferência: as fichas com auditor e se ficaram ligadas a um colaborador
SELECT a.codigo, a.fornecedor, a.auditor, e.full_name AS colaborador_ligado, a.agendada_para, a.horario
  FROM auditorias_fornecedores a LEFT JOIN employees e ON e.id = a.auditor_id
 WHERE nullif(trim(a.auditor), '') IS NOT NULL
 ORDER BY a.agendada_para NULLS LAST;
