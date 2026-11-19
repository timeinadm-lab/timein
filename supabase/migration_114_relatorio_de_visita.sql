-- ============================================================
-- Migration 114 — Relatório de visita feito dentro do sistema
-- ------------------------------------------------------------
-- Pedido do Gabriel (20/11/2026): hoje o relatório é feito no FoodChecker e o
-- PDF é anexado no ponto. Passa a ser feito aqui: escolhe o cliente, a data, a
-- hora que entrou e saiu, o objetivo, as anotações com fotos (não obrigatórias)
-- e o sistema gera o PDF no mesmo formato ("Visita do dia DD/MM/AAAA"), com a
-- nossa logo e a do cliente (só se o cliente tiver logo cadastrada).
--
-- O que cria:
--   · clients.logo_url ............. logo do cliente (aparece no canto do PDF)
--   · relatorios_visita ............ o relatório (anotações e fotos num só registro)
--   · funções portal_relatorio* .... a nutricionista faz pelo portal (aba Qualidade)
-- Ao finalizar, o PDF fica ligado à visita daquele dia naquele cliente (se ela
-- já registrou o ponto e ainda não tinha relatório anexado).
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url text;

CREATE TABLE IF NOT EXISTS relatorios_visita (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,      -- quem fez pelo portal
  user_id       uuid REFERENCES user_profiles(id) ON DELETE SET NULL,  -- quem fez pelo escritório
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,
  titulo        text NOT NULL,
  data          date NOT NULL,
  entrada       time,
  saida         time,
  objetivo      text,
  itens         jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{tipo:'nota'|'titulo', texto, fotos:[caminho]}]
  assinaturas   jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {consultor, cliente, cliente_nome, cliente_doc}
  autor_nome    text,
  autor_email   text,
  autor_cargo   text,
  autor_cpf     text,
  status        text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'finalizado')),
  pdf_url       text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS relatorios_visita_pessoa ON relatorios_visita (employee_id, data DESC);
CREATE INDEX IF NOT EXISTS relatorios_visita_cliente ON relatorios_visita (client_id, data DESC);

ALTER TABLE relatorios_visita ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "relatorios_equipe" ON relatorios_visita;
CREATE POLICY "relatorios_equipe" ON relatorios_visita FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON relatorios_visita;
    CREATE POLICY so_equipe ON relatorios_visita AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

-- Liga o PDF à visita do dia (mesma pessoa, cliente e data), sem trocar relatório que já existe
CREATE OR REPLACE FUNCTION relatorio_visita_no_ponto(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r relatorios_visita%ROWTYPE;
BEGIN
  SELECT * INTO r FROM relatorios_visita WHERE id = p_id;
  IF NOT FOUND OR r.status <> 'finalizado' OR r.pdf_url IS NULL OR r.employee_id IS NULL OR r.client_id IS NULL THEN RETURN; END IF;
  UPDATE nutritionist_visits v
     SET report_url = r.pdf_url
   WHERE v.employee_id = r.employee_id AND v.client_id = r.client_id AND v.visit_date = r.data
     AND NOT coalesce(v.is_unavailable, false)
     AND (v.report_url IS NULL OR v.report_url LIKE 'relatorios/visita/' || r.id::text || '/%');
END$$;
REVOKE ALL ON FUNCTION relatorio_visita_no_ponto(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION relatorio_visita_no_ponto(uuid) TO authenticated;

-- ── Portal ─────────────────────────────────────────────────────────────────
-- Lista dos relatórios dela (mais novos primeiro)
CREATE OR REPLACE FUNCTION portal_relatorios(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  RETURN jsonb_build_object(
    'autor', (SELECT jsonb_build_object('nome', e.full_name, 'email', e.email, 'cargo', coalesce(e.role, 'Nutricionista'), 'cpf', e.cpf)
                FROM employees e WHERE e.id = uid),
    'logos', coalesce((SELECT jsonb_object_agg(c.id, c.logo_url) FROM clients c
                        WHERE c.logo_url IS NOT NULL AND EXISTS (SELECT 1 FROM employee_client_links l WHERE l.employee_id = uid AND l.client_id = c.id)), '{}'::jsonb),
    'relatorios', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT r.id, r.titulo, r.data, r.status, r.pdf_url, r.client_id, c.name AS cliente,
               jsonb_array_length(r.itens) AS anotacoes
          FROM relatorios_visita r LEFT JOIN clients c ON c.id = r.client_id
         WHERE r.employee_id = uid ORDER BY r.data DESC, r.criado_em DESC LIMIT 200) x), '[]'::jsonb)
  );
END$$;

-- Um relatório dela, inteiro
CREATE OR REPLACE FUNCTION portal_relatorio(p_token text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token); r jsonb;
BEGIN
  SELECT to_jsonb(x) INTO r FROM relatorios_visita x WHERE x.id = p_id AND x.employee_id = uid;
  IF r IS NULL THEN RAISE EXCEPTION 'Relatório não encontrado.' USING ERRCODE = '42501'; END IF;
  RETURN r;
END$$;

-- Salvar (cria ou atualiza). O id vem do celular para as fotos já terem pasta.
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
  INSERT INTO relatorios_visita (id, employee_id, client_id, titulo, data, entrada, saida, objetivo, itens, assinaturas,
                                 autor_nome, autor_email, autor_cargo, autor_cpf, status, pdf_url)
  VALUES (v_id, uid, v_client,
          coalesce(nullif(btrim(p_dados->>'titulo'), ''), 'Visita do dia ' || to_char(v_data, 'DD/MM/YYYY')),
          v_data, nullif(p_dados->>'entrada', '')::time, nullif(p_dados->>'saida', '')::time,
          nullif(btrim(p_dados->>'objetivo'), ''),
          coalesce(p_dados->'itens', '[]'::jsonb), coalesce(p_dados->'assinaturas', '{}'::jsonb),
          e.full_name, e.email, coalesce(e.role, 'Nutricionista'), e.cpf, v_status, nullif(p_dados->>'pdf_url', ''))
  ON CONFLICT (id) DO UPDATE
     SET client_id = EXCLUDED.client_id, titulo = EXCLUDED.titulo, data = EXCLUDED.data, entrada = EXCLUDED.entrada,
         saida = EXCLUDED.saida, objetivo = EXCLUDED.objetivo, itens = EXCLUDED.itens, assinaturas = EXCLUDED.assinaturas,
         status = EXCLUDED.status, pdf_url = coalesce(EXCLUDED.pdf_url, relatorios_visita.pdf_url), atualizado_em = now();
  PERFORM relatorio_visita_no_ponto(v_id);
  RETURN v_id;
END$$;

CREATE OR REPLACE FUNCTION portal_relatorio_apagar(p_token text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := portal_uid(p_token);
BEGIN
  DELETE FROM relatorios_visita WHERE id = p_id AND employee_id = uid AND status = 'rascunho';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só dá para apagar relatório que ainda não foi finalizado.'; END IF;
END$$;

REVOKE ALL ON FUNCTION portal_relatorios(text), portal_relatorio(text, uuid), portal_relatorio_salvar(text, jsonb), portal_relatorio_apagar(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION portal_relatorios(text), portal_relatorio(text, uuid), portal_relatorio_salvar(text, jsonb), portal_relatorio_apagar(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 1 tabela e 4 funções
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'relatorios_visita') AS tabela,
       (SELECT count(*) FROM pg_proc WHERE proname LIKE 'portal_relatorio%') AS funcoes_portal,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'logo_url') AS logo_do_cliente;
