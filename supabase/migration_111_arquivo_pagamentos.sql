-- ============================================================
-- Migration 111 — Arquivo histórico de pagamentos
-- ------------------------------------------------------------
-- Pedido do Gabriel (19/11/2026): cada pagamento fechado (dia 8, 15 ou 20)
-- vira um registro para consulta. Guarda a data, o total, a quantidade de
-- pessoas e as linhas (nome, valor, observação opcional), mais uma
-- observação geral.
--
-- NÃO é um PDF guardado. O PDF e o Excel são gerados na hora, na tela
-- Financeiro > Planilhas > Histórico.
--
-- Cada pessoa tem a chave PIX (pode ficar vazia até alguém preencher).
-- CPF, agência e conta não entram. Nome e observação também não levam a
-- chave: ela fica só na coluna pix, para o PDF/Excel "sem PIX" poder sair
-- limpo. O padrão da tela é baixar sem PIX.
--
-- Não mexe em payments, em employee_payment_dates nem no cálculo de
-- pagamentos. Só a chefia (chefe e contabilidade, com acesso liberado) lê
-- e grava — a mesma regra de eh_chefia() (migração 077).
--
-- Pode rodar mais de uma vez. NÃO aplicar no banco até o dono aprovar.
-- O pagamento de 20/11/2026 está na migração 112, separada.
-- ============================================================

-- Recusa, em nome e observação, a palavra PIX, CPF e rótulo de conta.
-- A coluna pix não usa esta função: a chave (e-mail, telefone, aleatória
-- ou o número usado como chave) fica lá. Não lê dado nenhum.
CREATE OR REPLACE FUNCTION arquivo_tem_dado_bancario(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT t IS NOT NULL AND (
       t ~* '\mpix\M'
    OR t ~* '\mcpf\M'
    OR t ~ '\d{3}\.\d{3}\.\d{3}-\d{2}'
    OR t ~ '(^|[^0-9])[0-9]{11}([^0-9]|$)'
    OR t ~* 'ag[eê]ncia[[:space:]]*[0-9]'
    OR t ~* '\mconta[[:space:]]+corrente\M'
    OR t ~* 'c/c'
  );
$$;
REVOKE ALL ON FUNCTION arquivo_tem_dado_bancario(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arquivo_tem_dado_bancario(text) TO authenticated;

CREATE TABLE IF NOT EXISTS arquivo_pagamentos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_pagamento   date NOT NULL,
  observacao       text,
  total            numeric(12,2) NOT NULL DEFAULT 0,
  quantidade       integer NOT NULL DEFAULT 0,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS arquivo_pagamentos_data_uk ON arquivo_pagamentos (data_pagamento);

CREATE TABLE IF NOT EXISTS arquivo_pagamento_linhas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_id    uuid NOT NULL REFERENCES arquivo_pagamentos(id) ON DELETE CASCADE,
  ordem         integer NOT NULL DEFAULT 0,
  nome          text NOT NULL,
  valor         numeric(12,2) NOT NULL,
  pix           text,
  observacao    text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arquivo_pagamento_linhas_arquivo ON arquivo_pagamento_linhas (arquivo_id, ordem);
ALTER TABLE arquivo_pagamento_linhas ADD COLUMN IF NOT EXISTS pix text;

COMMENT ON TABLE arquivo_pagamentos IS
  'Pagamentos fechados (dia 8, 15 ou 20). Data, total, quantidade, observação e as linhas.';
COMMENT ON TABLE arquivo_pagamento_linhas IS
  'Uma pessoa do pagamento fechado: nome, valor, chave PIX e observação. Sem CPF, agência ou conta.';
COMMENT ON COLUMN arquivo_pagamento_linhas.pix IS
  'Chave PIX. Vazia até preencher. Não sai no PDF/Excel, a menos que peçam a versão de uso interno.';
COMMENT ON COLUMN arquivo_pagamentos.total IS 'Soma das linhas. A tela não grava este número: o gatilho recalcula.';
COMMENT ON COLUMN arquivo_pagamentos.quantidade IS 'Quantidade de pessoas (linhas). Recalculada pelo gatilho.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arquivo_pagamentos_dia') THEN
    ALTER TABLE arquivo_pagamentos ADD CONSTRAINT arquivo_pagamentos_dia
      CHECK (EXTRACT(DAY FROM data_pagamento) IN (8, 15, 20));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arquivo_pagamentos_sem_banco') THEN
    ALTER TABLE arquivo_pagamentos ADD CONSTRAINT arquivo_pagamentos_sem_banco
      CHECK (NOT arquivo_tem_dado_bancario(COALESCE(observacao, '')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arquivo_linha_nome') THEN
    ALTER TABLE arquivo_pagamento_linhas ADD CONSTRAINT arquivo_linha_nome
      CHECK (btrim(nome) <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arquivo_linha_valor') THEN
    ALTER TABLE arquivo_pagamento_linhas ADD CONSTRAINT arquivo_linha_valor
      CHECK (valor >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arquivo_linha_sem_banco') THEN
    ALTER TABLE arquivo_pagamento_linhas ADD CONSTRAINT arquivo_linha_sem_banco
      CHECK (NOT arquivo_tem_dado_bancario(nome) AND NOT arquivo_tem_dado_bancario(COALESCE(observacao, '')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arquivo_linha_pix') THEN
    ALTER TABLE arquivo_pagamento_linhas ADD CONSTRAINT arquivo_linha_pix
      CHECK (pix IS NULL OR NOT (
           pix ~* 'ag[eê]ncia[[:space:]]*[0-9]'
        OR pix ~* 'conta[[:space:]]+corrente'
        OR pix ~* 'c/c'
        OR pix ~* '\mcpf\M'
      ));
  END IF;
END$$;

-- Total e quantidade acompanham as linhas. O que a tela mandar nesses
-- campos é ignorado.
CREATE OR REPLACE FUNCTION arquivo_pagamento_ajusta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  alvo uuid;
BEGIN
  IF TG_TABLE_NAME = 'arquivo_pagamentos' THEN
    IF NEW.id IS NULL THEN
      NEW.id := gen_random_uuid();
    END IF;
    SELECT COALESCE(sum(valor), 0), COALESCE(count(*)::int, 0)
      INTO NEW.total, NEW.quantidade
      FROM arquivo_pagamento_linhas
     WHERE arquivo_id = NEW.id;
    NEW.atualizado_em := now();
    RETURN NEW;
  END IF;

  alvo := COALESCE(NEW.arquivo_id, OLD.arquivo_id);
  UPDATE arquivo_pagamentos SET atualizado_em = now() WHERE id = alvo;
  IF TG_OP = 'UPDATE' AND OLD.arquivo_id IS DISTINCT FROM NEW.arquivo_id THEN
    UPDATE arquivo_pagamentos SET atualizado_em = now() WHERE id = OLD.arquivo_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION arquivo_pagamento_ajusta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS arquivo_pagamentos_antes ON arquivo_pagamentos;
CREATE TRIGGER arquivo_pagamentos_antes
  BEFORE INSERT OR UPDATE ON arquivo_pagamentos
  FOR EACH ROW EXECUTE FUNCTION arquivo_pagamento_ajusta();

DROP TRIGGER IF EXISTS arquivo_linhas_depois ON arquivo_pagamento_linhas;
CREATE TRIGGER arquivo_linhas_depois
  AFTER INSERT OR UPDATE OR DELETE ON arquivo_pagamento_linhas
  FOR EACH ROW EXECUTE FUNCTION arquivo_pagamento_ajusta();

-- Grava o registro e as linhas numa tacada só. Quem chama é o usuário
-- logado (não é security definer): a regra abaixo continua valendo.
CREATE OR REPLACE FUNCTION salvar_arquivo_pagamento(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_data date;
  v_obs text;
  v_linha jsonb;
  v_nome text;
  v_obs_linha text;
  v_pix text;
  v_valor numeric;
  i int := 0;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Dados do pagamento inválidos.';
  END IF;
  BEGIN
    v_data := (p->>'data_pagamento')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Data de pagamento inválida.';
  END;
  IF EXTRACT(DAY FROM v_data) NOT IN (8, 15, 20) THEN
    RAISE EXCEPTION 'A data de pagamento precisa ser dia 8, 15 ou 20.';
  END IF;
  v_obs := NULLIF(btrim(COALESCE(p->>'observacao', '')), '');
  IF arquivo_tem_dado_bancario(COALESCE(v_obs, '')) THEN
    RAISE EXCEPTION 'A observação não pode ter CPF, dado bancário nem a chave PIX. A chave fica na linha.';
  END IF;

  IF NULLIF(p->>'id', '') IS NULL THEN
    INSERT INTO arquivo_pagamentos (data_pagamento, observacao)
    VALUES (v_data, v_obs)
    RETURNING id INTO v_id;
  ELSE
    v_id := (p->>'id')::uuid;
    UPDATE arquivo_pagamentos
       SET data_pagamento = v_data,
           observacao = v_obs
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registro não encontrado.';
    END IF;
    DELETE FROM arquivo_pagamento_linhas WHERE arquivo_id = v_id;
  END IF;

  FOR v_linha IN SELECT value FROM jsonb_array_elements(COALESCE(p->'linhas', '[]'::jsonb))
  LOOP
    i := i + 1;
    IF v_linha ? 'cpf' OR v_linha ? 'banco' OR v_linha ? 'agencia' OR v_linha ? 'conta' THEN
      RAISE EXCEPTION 'Não guardamos CPF nem dados bancários. Só a chave PIX.';
    END IF;
    v_nome := btrim(COALESCE(v_linha->>'nome', ''));
    v_obs_linha := NULLIF(btrim(COALESCE(v_linha->>'observacao', '')), '');
    v_pix := NULLIF(btrim(COALESCE(v_linha->>'pix', '')), '');
    IF v_nome = '' THEN
      RAISE EXCEPTION 'A linha % está sem nome.', i;
    END IF;
    BEGIN
      v_valor := round((v_linha->>'valor')::numeric, 2);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'A linha % está sem valor.', i;
    END;
    IF v_valor IS NULL OR v_valor < 0 THEN
      RAISE EXCEPTION 'A linha % está sem valor.', i;
    END IF;
    IF arquivo_tem_dado_bancario(v_nome) OR arquivo_tem_dado_bancario(COALESCE(v_obs_linha, '')) THEN
      RAISE EXCEPTION 'A linha % tem CPF, dado bancário ou chave PIX fora da coluna. A chave fica no campo PIX.', i;
    END IF;
    IF v_pix IS NOT NULL AND (
         v_pix ~* 'ag[eê]ncia[[:space:]]*[0-9]'
      OR v_pix ~* 'conta[[:space:]]+corrente'
      OR v_pix ~* 'c/c'
      OR v_pix ~* '\mcpf\M'
    ) THEN
      RAISE EXCEPTION 'A chave PIX da linha % não pode trazer agência, conta ou a palavra CPF.', i;
    END IF;
    INSERT INTO arquivo_pagamento_linhas (arquivo_id, ordem, nome, valor, pix, observacao)
    VALUES (v_id, i, v_nome, v_valor, v_pix, v_obs_linha);
  END LOOP;
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um registro neste dia de pagamento.';
END;
$$;
REVOKE ALL ON FUNCTION salvar_arquivo_pagamento(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION salvar_arquivo_pagamento(jsonb) TO authenticated;

-- ── Acesso: só a chefia ──────────────────────────────────────────────────
ALTER TABLE arquivo_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquivo_pagamento_linhas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON arquivo_pagamentos FROM PUBLIC, anon;
REVOKE ALL ON arquivo_pagamento_linhas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON arquivo_pagamentos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arquivo_pagamento_linhas TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_chefia') THEN
    RAISE EXCEPTION 'Rode antes a migração 077 (função eh_chefia).';
  END IF;
END$$;

DROP POLICY IF EXISTS so_chefia ON arquivo_pagamentos;
CREATE POLICY so_chefia ON arquivo_pagamentos
  FOR ALL TO authenticated
  USING ((SELECT eh_chefia()))
  WITH CHECK ((SELECT eh_chefia()));

DROP POLICY IF EXISTS so_chefia ON arquivo_pagamento_linhas;
CREATE POLICY so_chefia ON arquivo_pagamento_linhas
  FOR ALL TO authenticated
  USING ((SELECT eh_chefia()))
  WITH CHECK ((SELECT eh_chefia()));

-- Segunda trava, igual às tabelas novas depois da 077: conta bloqueada não entra.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON arquivo_pagamentos;
    CREATE POLICY so_equipe ON arquivo_pagamentos AS RESTRICTIVE
      FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe()))
      WITH CHECK ((SELECT eh_da_equipe()));
    DROP POLICY IF EXISTS so_equipe ON arquivo_pagamento_linhas;
    CREATE POLICY so_equipe ON arquivo_pagamento_linhas AS RESTRICTIVE
      FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe()))
      WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência (esperado: rls ligada nas duas, 2 políticas em cada uma se a 077 já rodou)
SELECT c.relname AS tabela,
       c.relrowsecurity AS rls_ligada,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS politicas
  FROM pg_class c
 WHERE c.relname IN ('arquivo_pagamentos', 'arquivo_pagamento_linhas')
 ORDER BY c.relname;
