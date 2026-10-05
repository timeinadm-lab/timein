-- ============================================================
-- Migration 082 — Aba "Qualidade" no portal: checklists pela nutricionista
-- ------------------------------------------------------------
-- Pedido de 05/10/2026: toda nutricionista pode fazer checklist (auditoria)
-- pelo portal, em qualquer checklist ativo, nos clientes em que tem vínculo.
-- Tudo passa por funções portal_* que conferem o token (como o resto do
-- portal): a chave pública continua sem ler nenhuma tabela.
--  - auditorias ganha employee_id (quem fez pelo portal) e origem.
--  - o portal pode ENVIAR fotos para a pasta auditorias/ (não lê nem apaga).
--  - a nota é calculada aqui no banco, não vem do celular.
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE auditorias ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE auditorias ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'sistema';
CREATE INDEX IF NOT EXISTS auditorias_pessoa ON auditorias (employee_id, data DESC);

-- Fotos: o portal envia para auditorias/ também (só criar arquivo, como os outros anexos)
DROP POLICY IF EXISTS "portal_anexos_envio" ON storage.objects;
CREATE POLICY "portal_anexos_envio" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'arquivos' AND (storage.foldername(name))[1] IN ('receipts', 'relatorios', 'atestados', 'auditorias'));

-- Auditoria da pessoa (e em andamento, quando for para mudar)
CREATE OR REPLACE FUNCTION portal_auditoria_dela(p_uid uuid, p_id uuid, p_editar boolean) RETURNS auditorias
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a auditorias%ROWTYPE;
BEGIN
  SELECT * INTO a FROM auditorias WHERE id = p_id AND employee_id = p_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checklist não encontrado.' USING ERRCODE = '42501'; END IF;
  IF p_editar AND a.status <> 'rascunho' THEN RAISE EXCEPTION 'Este checklist já foi finalizado.'; END IF;
  RETURN a;
END$$;
REVOKE ALL ON FUNCTION portal_auditoria_dela(uuid, uuid, boolean) FROM public, anon;

-- Checklists disponíveis + as auditorias dela
CREATE OR REPLACE FUNCTION portal_qualidade(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  RETURN jsonb_build_object(
    'modelos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome,
                  'perguntas', (SELECT count(*) FROM auditoria_perguntas p WHERE p.modelo_id = m.id AND p.ativo)) ORDER BY m.nome)
                FROM auditoria_modelos m WHERE m.ativo), '[]'::jsonb),
    'auditorias', coalesce((SELECT jsonb_agg(x ORDER BY x.data DESC, x.criado_em DESC) FROM (
                  SELECT a.id, a.titulo, a.data, a.status, a.nota, a.faixas, a.unidade, a.criado_em, c.name AS cliente,
                         (SELECT count(*) FROM auditoria_respostas r WHERE r.auditoria_id = a.id) AS total,
                         (SELECT count(*) FROM auditoria_respostas r WHERE r.auditoria_id = a.id AND r.resposta IS NOT NULL) AS respondidas
                    FROM auditorias a LEFT JOIN clients c ON c.id = a.client_id
                   WHERE a.employee_id = uid ORDER BY a.data DESC, a.criado_em DESC LIMIT 100) x), '[]'::jsonb)
  );
END$$;

-- Começar um checklist (copia as perguntas do modelo, como no sistema)
CREATE OR REPLACE FUNCTION portal_auditoria_criar(p_token text, p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := portal_uid(p_token);
  v_modelo uuid := nullif(p_payload->>'modelo_id', '')::uuid;
  v_client uuid := nullif(p_payload->>'client_id', '')::uuid;
  m auditoria_modelos%ROWTYPE;
  e employees%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Escolha o cliente.'; END IF;
  PERFORM portal_assert_link(uid, v_client);
  SELECT * INTO m FROM auditoria_modelos WHERE id = v_modelo AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checklist não encontrado.'; END IF;
  SELECT * INTO e FROM employees WHERE id = uid;
  INSERT INTO auditorias (modelo_id, titulo, faixas, client_id, unidade, concessionaria, auditor_nome, auditor_email,
                          data, inicio, fim, employee_id, origem)
  VALUES (m.id, m.nome, m.faixas, v_client, nullif(btrim(p_payload->>'unidade'), ''), nullif(btrim(p_payload->>'concessionaria'), ''),
          coalesce(nullif(btrim(p_payload->>'auditor_nome'), ''), e.full_name),
          coalesce(nullif(lower(btrim(p_payload->>'auditor_email')), ''), lower(e.email)),
          coalesce(nullif(p_payload->>'data', '')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
          nullif(p_payload->>'inicio', '')::time, nullif(p_payload->>'fim', '')::time, uid, 'portal')
  RETURNING id INTO v_id;
  INSERT INTO auditoria_respostas (auditoria_id, pergunta_id, grupo, secao, texto, peso, ordem, foto_obrigatoria)
  SELECT v_id, p.id, p.grupo, p.secao, p.texto, p.peso, p.ordem, p.foto_obrigatoria
    FROM auditoria_perguntas p WHERE p.modelo_id = m.id AND p.ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esse checklist não tem perguntas.'; END IF;
  RETURN v_id;
END$$;

-- Abrir: cabeçalho + perguntas
CREATE OR REPLACE FUNCTION portal_auditoria_abrir(p_token text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token); a auditorias%ROWTYPE;
BEGIN
  a := portal_auditoria_dela(uid, p_id, false);
  RETURN jsonb_build_object(
    'auditoria', to_jsonb(a) || jsonb_build_object('cliente', (SELECT name FROM clients WHERE id = a.client_id)),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'grupo', r.grupo, 'secao', r.secao, 'texto', r.texto,
                 'peso', r.peso, 'ordem', r.ordem, 'resposta', r.resposta, 'observacao', r.observacao, 'fotos', r.fotos,
                 'foto_obrigatoria', r.foto_obrigatoria) ORDER BY r.ordem)
               FROM auditoria_respostas r WHERE r.auditoria_id = a.id), '[]'::jsonb));
END$$;

-- Responder uma pergunta (resposta, observação e fotos — só fotos da pasta deste checklist)
CREATE OR REPLACE FUNCTION portal_auditoria_responder(p_token text, p_item uuid, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token); v_aud uuid; v_fotos text[];
BEGIN
  SELECT auditoria_id INTO v_aud FROM auditoria_respostas WHERE id = p_item;
  IF v_aud IS NULL THEN RAISE EXCEPTION 'Pergunta não encontrada.'; END IF;
  PERFORM portal_auditoria_dela(uid, v_aud, true);
  IF p_payload ? 'resposta' AND coalesce(p_payload->>'resposta', 'C') NOT IN ('C', 'NC', 'NA') THEN
    RAISE EXCEPTION 'Resposta inválida.';
  END IF;
  IF p_payload ? 'fotos' THEN
    SELECT coalesce(array_agg(f), '{}') INTO v_fotos FROM jsonb_array_elements_text(p_payload->'fotos') f;
    IF EXISTS (SELECT 1 FROM unnest(v_fotos) f WHERE f NOT LIKE 'auditorias/' || v_aud || '/%') THEN
      RAISE EXCEPTION 'Foto fora da pasta deste checklist.' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE auditoria_respostas SET
    resposta   = CASE WHEN p_payload ? 'resposta' THEN p_payload->>'resposta' ELSE resposta END,
    observacao = CASE WHEN p_payload ? 'observacao' THEN nullif(btrim(p_payload->>'observacao'), '') ELSE observacao END,
    fotos      = CASE WHEN p_payload ? 'fotos' THEN v_fotos ELSE fotos END,
    atualizado_em = now()
  WHERE id = p_item;
END$$;

-- Cabeçalho (horário, unidade, concessionária, observações gerais)
CREATE OR REPLACE FUNCTION portal_auditoria_salvar(p_token text, p_id uuid, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  PERFORM portal_auditoria_dela(uid, p_id, true);
  UPDATE auditorias SET
    inicio         = CASE WHEN p_payload ? 'inicio' THEN nullif(p_payload->>'inicio', '')::time ELSE inicio END,
    fim            = CASE WHEN p_payload ? 'fim' THEN nullif(p_payload->>'fim', '')::time ELSE fim END,
    unidade        = CASE WHEN p_payload ? 'unidade' THEN nullif(btrim(p_payload->>'unidade'), '') ELSE unidade END,
    concessionaria = CASE WHEN p_payload ? 'concessionaria' THEN nullif(btrim(p_payload->>'concessionaria'), '') ELSE concessionaria END,
    observacoes    = CASE WHEN p_payload ? 'observacoes' THEN nullif(btrim(p_payload->>'observacoes'), '') ELSE observacoes END
  WHERE id = p_id;
END$$;

-- Finalizar: confere tudo e calcula a nota aqui (peso das conformes ÷ peso das avaliadas)
CREATE OR REPLACE FUNCTION portal_auditoria_finalizar(p_token text, p_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token); v_pend int; v_foto int; v_ok numeric; v_tot numeric; v_nota numeric;
BEGIN
  PERFORM portal_auditoria_dela(uid, p_id, true);
  SELECT count(*) FILTER (WHERE resposta IS NULL),
         count(*) FILTER (WHERE foto_obrigatoria AND resposta IN ('C', 'NC') AND coalesce(array_length(fotos, 1), 0) = 0),
         coalesce(sum(peso) FILTER (WHERE resposta = 'C'), 0),
         coalesce(sum(peso) FILTER (WHERE resposta IN ('C', 'NC')), 0)
    INTO v_pend, v_foto, v_ok, v_tot
    FROM auditoria_respostas WHERE auditoria_id = p_id;
  IF v_pend > 0 THEN RAISE EXCEPTION 'Faltam % pergunta(s) sem resposta.', v_pend; END IF;
  IF v_foto > 0 THEN RAISE EXCEPTION 'Falta foto em % pergunta(s) com foto obrigatória.', v_foto; END IF;
  v_nota := CASE WHEN v_tot > 0 THEN round(100 * v_ok / v_tot, 1) END;
  UPDATE auditorias SET status = 'finalizada', nota = v_nota, finalizada_em = now(),
         fim = coalesce(fim, (now() AT TIME ZONE 'America/Sao_Paulo')::time(0))
   WHERE id = p_id;
  RETURN v_nota;
END$$;

-- Excluir (só em andamento). As fotos ficam no armazenamento; o escritório limpa se quiser.
CREATE OR REPLACE FUNCTION portal_auditoria_excluir(p_token text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  PERFORM portal_auditoria_dela(uid, p_id, true);
  DELETE FROM auditorias WHERE id = p_id;
END$$;

GRANT EXECUTE ON FUNCTION portal_qualidade(text) TO anon;
GRANT EXECUTE ON FUNCTION portal_auditoria_criar(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION portal_auditoria_abrir(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION portal_auditoria_responder(text, uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION portal_auditoria_salvar(text, uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION portal_auditoria_finalizar(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION portal_auditoria_excluir(text, uuid) TO anon;

NOTIFY pgrst, 'reload schema';

-- Conferência: as 7 funções do portal
SELECT proname AS funcao FROM pg_proc WHERE proname LIKE 'portal_qualidade' OR proname LIKE 'portal_auditoria_%' ORDER BY 1;
