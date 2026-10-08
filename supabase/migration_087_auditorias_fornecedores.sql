-- ============================================================
-- Migration 087 — Controle das auditorias de fornecedores (GRSA)
-- ------------------------------------------------------------
-- Pedido de 08/10/2026: a planilha "Status Auditorias Fornecedores GRSA"
-- passa a viver no sistema. Uso interno (equipe logada); o portal das
-- nutricionistas não enxerga. Um registro por fornecedor/planta, do
-- orçamento até a validade da próxima auditoria (3 anos).
-- Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS auditorias_fornecedores (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                  text NOT NULL UNIQUE,              -- GRSA-001, GRSA-010A…
  fornecedor              text NOT NULL,
  planta                  text,
  status                  text NOT NULL DEFAULT 'Aguardando aprovação',
  proxima_acao            text,
  cnpj                    text,
  categoria               text,
  produtos                text,
  tipo                    text CHECK (tipo IN ('Inicial', 'Renovação')),
  cidade                  text,
  uf                      text,
  endereco                text,
  contato                 text,
  email                   text,
  telefone                text,
  comprador               text,
  unidade_grsa            text,
  cr                      text,
  responsavel_pagamento   text,
  valor_auditoria         numeric(10,2),
  deslocamento            numeric(10,2),
  cidade_polo             text,
  orcamento_enviado_em    date,
  aprovado_em             date,
  pagamento               text NOT NULL DEFAULT 'Não confirmado',
  pago_em                 date,
  comprovante_enviado     boolean NOT NULL DEFAULT false,
  comprovante_recebido_em date,
  agendada_para           date,
  horario                 text,
  realizada_em            date,
  auditor                 text,
  nota                    numeric(5,1),
  resultado               text,
  validade                date,
  auditoria_id            uuid REFERENCES auditorias(id) ON DELETE SET NULL,
  observacoes             text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aud_forn_status_ok CHECK (status IN (
    'Aguardando aprovação', 'Aguardando retorno do fornecedor', 'Aguardando definição de laboratório',
    'Agendada', 'Concluída', 'Cancelada', 'Encerrada – outro prestador', 'Encerrada – auditoria vigente')),
  CONSTRAINT aud_forn_pagamento_ok CHECK (pagamento IN ('Não confirmado', 'Informado – comprovante enviado', 'Pago'))
);
CREATE INDEX IF NOT EXISTS aud_forn_status ON auditorias_fornecedores (status);

-- Só a equipe logada (e liberada); mesmo padrão das outras tabelas de auditoria
ALTER TABLE auditorias_fornecedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipe_usa ON auditorias_fornecedores;
CREATE POLICY equipe_usa ON auditorias_fornecedores FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON auditorias_fornecedores;
    CREATE POLICY so_equipe ON auditorias_fornecedores AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência: tabela criada, RLS ligada, quantas políticas (esperado: t · 2)
SELECT c.relrowsecurity AS rls_ligada,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'auditorias_fornecedores') AS politicas
  FROM pg_class c WHERE c.relname = 'auditorias_fornecedores';
