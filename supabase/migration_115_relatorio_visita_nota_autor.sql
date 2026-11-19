-- ============================================================
-- Migration 115 — Relatório de visita: campo Nota e nome/e-mail de quem fez
-- ------------------------------------------------------------
-- Pedido do Gabriel (20/11/2026), ao ver a primeira versão: a tela tem que ser
-- igual à "Ata de Visita" que a equipe já usa — Data, Hora Inicial, Hora Final,
-- Título, Nota (não obrigatória) e Observações Gerais / Objetivo. E o nome
-- completo e o e-mail de quem faz ficam salvos e já vêm preenchidos.
--   · relatorios_visita.nota ........ a nota da visita (opcional)
--   · portal_relatorio_salvar ....... passa a guardar a nota e o nome/e-mail
--     que a pessoa confirmou (se vier vazio, usa o do cadastro, como antes)
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE relatorios_visita ADD COLUMN IF NOT EXISTS nota text;

CREATE OR REPLACE FUNCTION portal_relatorio_salvar(p_token text, p_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  v_id uuid := (p_dados->>'id')::uuid;
  v_client uuid := nullif(p_dados->>'client_id', '')::uuid;
  v_data date := coalesce(nullif(p_dados->>'data', '')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_status text := CASE WHEN p_dados->>'status' = 'finalizado' THEN 'finalizado' ELSE 'rascunho' END;
  e employees%ROWTYPE;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Relatório sem identificação.'; END IF;
  IF v_client IS NULL THEN RAISE EXCEPTION 'Escolha o cliente.'; END IF;
  PERFORM portal_assert_link(uid, v_client);
  IF EXISTS (SELECT 1 FROM relatorios_visita WHERE id = v_id AND employee_id IS DISTINCT FROM uid) THEN
    RAISE EXCEPTION 'Relatório não encontrado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM employees WHERE id = uid;
  INSERT INTO relatorios_visita (id, employee_id, client_id, titulo, data, entrada, saida, objetivo, nota, itens, assinaturas,
                                 autor_nome, autor_email, autor_cargo, autor_cpf, status, pdf_url)
  VALUES (v_id, uid, v_client,
          coalesce(nullif(btrim(p_dados->>'titulo'), ''), 'Visita do dia ' || to_char(v_data, 'DD/MM/YYYY')),
          v_data, nullif(p_dados->>'entrada', '')::time, nullif(p_dados->>'saida', '')::time,
          nullif(btrim(p_dados->>'objetivo'), ''), nullif(btrim(p_dados->>'nota'), ''),
          coalesce(p_dados->'itens', '[]'::jsonb), coalesce(p_dados->'assinaturas', '{}'::jsonb),
          coalesce(nullif(btrim(p_dados->>'autor_nome'), ''), e.full_name),
          coalesce(nullif(lower(btrim(p_dados->>'autor_email')), ''), e.email),
          coalesce(e.role, 'Nutricionista'), e.cpf, v_status, nullif(p_dados->>'pdf_url', ''))
  ON CONFLICT (id) DO UPDATE
     SET client_id = EXCLUDED.client_id, titulo = EXCLUDED.titulo, data = EXCLUDED.data, entrada = EXCLUDED.entrada,
         saida = EXCLUDED.saida, objetivo = EXCLUDED.objetivo, nota = EXCLUDED.nota, itens = EXCLUDED.itens,
         assinaturas = EXCLUDED.assinaturas, autor_nome = EXCLUDED.autor_nome, autor_email = EXCLUDED.autor_email,
         status = EXCLUDED.status, pdf_url = coalesce(EXCLUDED.pdf_url, relatorios_visita.pdf_url), atualizado_em = now();
  PERFORM relatorio_visita_no_ponto(v_id);
  RETURN v_id;
END$$;
REVOKE ALL ON FUNCTION portal_relatorio_salvar(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION portal_relatorio_salvar(text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS deve_dar_1 FROM information_schema.columns WHERE table_name = 'relatorios_visita' AND column_name = 'nota';
