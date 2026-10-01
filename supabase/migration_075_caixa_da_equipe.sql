-- ============================================================
-- Migration 075 — Caixa da equipe (compras e reembolsos)
-- ------------------------------------------------------------
-- Pedido do Gabriel (01/10/2026): a equipe (quem tem login no sistema) faz
-- compras a pedido da chefe. A PRÓPRIA pessoa lança tudo:
--   · recebido  — dinheiro que recebeu para compras (ex.: R$ 3.000)
--   · compra    — cada compra, com o comprovante (obrigatório)
--   · devolvido — o que sobrou e foi devolvido
-- Saldo = recebido − compras − devolvido. Positivo: está com ela (devolver ou
-- usar). Negativo: gastou do bolso (a receber). Entra no relatório da semana/mês.
--
-- Quem vê: cada um vê e lança só o seu; chefe e contabilidade veem todos.
-- Não mexe em nenhum dado existente.
-- ============================================================

-- Chefia: chefe ou contabilidade (os chefes)
CREATE OR REPLACE FUNCTION eh_chefia() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('chefe', 'contabilidade'))
$$;
REVOKE ALL ON FUNCTION eh_chefia() FROM public, anon;
GRANT EXECUTE ON FUNCTION eh_chefia() TO authenticated;

CREATE TABLE IF NOT EXISTS equipe_caixa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('recebido', 'compra', 'devolvido')),
  data        date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  valor       numeric(10,2) NOT NULL CHECK (valor > 0),
  descricao   text NOT NULL CHECK (btrim(descricao) <> ''),
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  comprovante text,                                      -- caminho no armazenamento ('arquivos')
  criado_em   timestamptz NOT NULL DEFAULT now(),
  -- Compra sem comprovante não entra: é o que comprova para a chefe
  CONSTRAINT compra_com_comprovante CHECK (tipo <> 'compra' OR comprovante IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS equipe_caixa_pessoa_data ON equipe_caixa (user_id, data);

ALTER TABLE equipe_caixa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "caixa_ver" ON equipe_caixa;
DROP POLICY IF EXISTS "caixa_lancar" ON equipe_caixa;
DROP POLICY IF EXISTS "caixa_editar" ON equipe_caixa;
DROP POLICY IF EXISTS "caixa_apagar" ON equipe_caixa;
CREATE POLICY "caixa_ver"    ON equipe_caixa FOR SELECT TO authenticated USING (user_id = auth.uid() OR eh_chefia());
CREATE POLICY "caixa_lancar" ON equipe_caixa FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "caixa_editar" ON equipe_caixa FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "caixa_apagar" ON equipe_caixa FOR DELETE TO authenticated USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 1
SELECT count(*) AS deve_dar_1 FROM information_schema.tables WHERE table_name = 'equipe_caixa';
