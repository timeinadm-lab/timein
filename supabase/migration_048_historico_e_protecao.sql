-- ============================================================
-- Migration 048 — Histórico de alterações + trava contra apagamento
-- ------------------------------------------------------------
-- POR QUE ISSO EXISTE
-- Cinco candidatos ficaram sem nome, WhatsApp, e-mail e CRN, e não houve como
-- provar quando nem restaurar: o banco não guardava versão anterior e o
-- updated_at nunca era atualizado (não havia gatilho nenhum).
--
-- Esta migração cria três camadas, todas no BANCO — valem para o site, para o
-- portal e até para um comando rodado à mão aqui no SQL Editor:
--
--   1. HISTÓRICO   — toda alteração guarda a versão anterior. Dá para desfazer.
--   2. TRAVA       — apagar o nome de um cadastro passa a dar erro, não passa.
--   3. UPDATED_AT  — volta a marcar quando o registro mudou pela última vez.
--
-- Não altera nenhum dado existente. Roda em segundos.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. HISTÓRICO DE ALTERAÇÕES
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS registro_historico (
  id           BIGSERIAL PRIMARY KEY,
  tabela       TEXT        NOT NULL,
  registro_id  UUID        NOT NULL,
  operacao     TEXT        NOT NULL,          -- UPDATE ou DELETE
  dados_antes  JSONB       NOT NULL,          -- como o registro estava
  alterado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  alterado_por TEXT                            -- usuário logado, quando dá pra saber
);

CREATE INDEX IF NOT EXISTS idx_historico_registro
  ON registro_historico (tabela, registro_id, alterado_em DESC);
CREATE INDEX IF NOT EXISTS idx_historico_data
  ON registro_historico (alterado_em DESC);

ALTER TABLE registro_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_historico" ON registro_historico;
CREATE POLICY "auth_read_historico" ON registro_historico
  FOR SELECT USING (auth.role() = 'authenticated');
-- Ninguém escreve à mão: só o gatilho, que roda como dono da função.

CREATE OR REPLACE FUNCTION registrar_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- UPDATE que não mudou nada não vira linha de histórico
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;

  INSERT INTO registro_historico (tabela, registro_id, operacao, dados_antes, alterado_por)
  VALUES (TG_TABLE_NAME, OLD.id, TG_OP, to_jsonb(OLD),
          COALESCE(NULLIF(current_setting('request.jwt.claim.email', true), ''),
                   NULLIF(auth.uid()::text, ''),
                   'portal/sistema'));

  RETURN COALESCE(NEW, OLD);
END$$;

-- Liga o histórico nas tabelas que doem quando se perdem.
-- Folha de ponto (nutritionist_visits) ficou de fora de propósito: é a tabela
-- de maior volume e o dado se refaz pelo portal. Dá pra incluir depois.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'candidates', 'employees', 'clients',
    'employee_client_links', 'payments', 'contracts'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_historico ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_historico BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION registrar_historico()', t);
    END IF;
  END LOOP;
END$$;


-- ════════════════════════════════════════════════════════════
-- 2. TRAVA — não deixa apagar o nome de um cadastro
-- ════════════════════════════════════════════════════════════
-- Protege só os campos de IDENTIDADE. É o bastante: a gravação que apagava
-- "tudo" é recusada inteira, então os outros campos vão junto na carona.
-- Limpar um e-mail ou telefone digitado errado continua permitido.

CREATE OR REPLACE FUNCTION protege_campos_de_identidade()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  campo   TEXT;
  antes   TEXT;
  depois  TEXT;
BEGIN
  FOREACH campo IN ARRAY TG_ARGV LOOP
    antes  := to_jsonb(OLD) ->> campo;
    depois := to_jsonb(NEW) ->> campo;
    IF antes IS NOT NULL AND btrim(antes) <> ''
       AND (depois IS NULL OR btrim(depois) = '') THEN
      RAISE EXCEPTION
        'Não dá para apagar % de um cadastro que já tinha "%". Se a tela abriu em branco, recarregue a página antes de salvar.',
        campo, antes
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_protege_identidade ON candidates;
CREATE TRIGGER trg_protege_identidade BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION protege_campos_de_identidade('full_name');

DROP TRIGGER IF EXISTS trg_protege_identidade ON employees;
CREATE TRIGGER trg_protege_identidade BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION protege_campos_de_identidade('full_name');

DROP TRIGGER IF EXISTS trg_protege_identidade ON clients;
CREATE TRIGGER trg_protege_identidade BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION protege_campos_de_identidade('name');


-- ════════════════════════════════════════════════════════════
-- 3. UPDATED_AT — a coluna existia mas nada a atualizava
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION marca_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'updated_at'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION marca_updated_at()', t);
  END LOOP;
END$$;


-- ════════════════════════════════════════════════════════════
-- 4. DESFAZER — devolve um registro a uma versão anterior
-- ════════════════════════════════════════════════════════════
-- Uso:
--   1) veja as versões:  SELECT * FROM ver_historico('candidates', '<id>');
--   2) restaure a que quiser:  SELECT restaurar_versao(<id_da_versao>);

CREATE OR REPLACE FUNCTION ver_historico(p_tabela TEXT, p_registro UUID)
RETURNS TABLE (versao BIGINT, quando TIMESTAMPTZ, quem TEXT, operacao TEXT, dados JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, alterado_em, alterado_por, operacao, dados_antes
    FROM registro_historico
   WHERE tabela = p_tabela AND registro_id = p_registro
   ORDER BY alterado_em DESC;
$$;

CREATE OR REPLACE FUNCTION restaurar_versao(p_versao BIGINT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h     registro_historico;
  cols  TEXT;
BEGIN
  SELECT * INTO h FROM registro_historico WHERE id = p_versao;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versão % não existe no histórico.', p_versao;
  END IF;

  -- Monta a lista de colunas da tabela, menos a chave
  SELECT string_agg(format('%I = r.%I', column_name, column_name), ', ')
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = h.tabela AND column_name <> 'id';

  EXECUTE format(
    'UPDATE %I t SET %s FROM jsonb_populate_record(NULL::%I, $1) r WHERE t.id = $2',
    h.tabela, cols, h.tabela)
  USING h.dados_antes, h.registro_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O registro % não existe mais em %. Restauração de registro APAGADO precisa de INSERT — me chame.', h.registro_id, h.tabela;
  END IF;

  RETURN format('Restaurado: %s %s para a versão de %s',
                h.tabela, h.registro_id, to_char(h.alterado_em, 'DD/MM/YYYY HH24:MI'));
END$$;

GRANT EXECUTE ON FUNCTION ver_historico(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION restaurar_versao(BIGINT)  TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- CONFERÊNCIA — o que ficou ligado
-- ════════════════════════════════════════════════════════════
SELECT c.relname AS tabela,
       count(*) FILTER (WHERE t.tgname = 'trg_historico')          AS historico,
       count(*) FILTER (WHERE t.tgname = 'trg_protege_identidade') AS trava_de_nome,
       count(*) FILTER (WHERE t.tgname = 'trg_updated_at')         AS updated_at
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND t.tgname IN ('trg_historico', 'trg_protege_identidade', 'trg_updated_at')
 GROUP BY c.relname
 ORDER BY c.relname;
