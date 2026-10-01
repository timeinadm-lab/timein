-- ============================================================
-- Migration 076 — Visita paga da equipe
-- ------------------------------------------------------------
-- Pedido do Gabriel (01/10/2026): a equipe (quem tem login no sistema) às
-- vezes faz visita a cliente, e ela é paga. A própria pessoa registra
-- (cliente, dia, horário, valor, relatório); a chefia aprova ou recusa.
-- Aprovada, vira um lançamento em Pagamentos com a regra da consultoria:
-- visita até o dia 15 vence no dia 20; depois do dia 15, no dia 8 do mês
-- seguinte. Esse lançamento é marcado (origem = 'visita_equipe') para não
-- entrar na conta da folha da pessoa.
--
-- O login pode ser ligado ao cadastro de colaborador (para o pagamento sair
-- com o nome, PIX e banco certos). Liga sozinho quem tem o mesmo nome; o
-- resto a chefia liga na tela Equipe.
-- Pode rodar mais de uma vez. Não muda nenhum valor existente.
-- ============================================================

-- ── 1. Login ↔ cadastro de colaborador ──────────────────────────────────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Mesmo nome (sem acento, sem maiúscula). Com cadastro repetido, fica o ativo com mais vínculos.
UPDATE user_profiles u SET employee_id = m.employee_id
  FROM (
    SELECT DISTINCT ON (u2.id) u2.id AS uid, e.id AS employee_id
      FROM user_profiles u2
      JOIN employees e
        ON lower(translate(btrim(e.full_name), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
         = lower(translate(btrim(u2.full_name), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
     WHERE u2.employee_id IS NULL
     ORDER BY u2.id, (e.status = 'Ativo') DESC,
              (SELECT count(*) FROM employee_client_links l WHERE l.employee_id = e.id) DESC, e.created_at
  ) m
 WHERE u.id = m.uid AND u.employee_id IS NULL;

-- ── 2. Lançamento de outra origem (não entra na conta da folha) ─────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS origem text;

-- ── 3. Visitas da equipe ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipe_visitas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,
  unidade       text,
  data          date NOT NULL,
  entrada       time,
  saida         time,
  valor         numeric(10,2) NOT NULL CHECK (valor > 0),
  relatorio     text,                                    -- caminho no armazenamento ('arquivos')
  observacoes   text,
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'recusada')),
  motivo_recusa text,
  decidido_por  uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  decidido_em   timestamptz,
  payment_id    uuid REFERENCES payments(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipe_visitas_pessoa_data ON equipe_visitas (user_id, data);

ALTER TABLE equipe_visitas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "visitas_equipe_ver" ON equipe_visitas;
DROP POLICY IF EXISTS "visitas_equipe_registrar" ON equipe_visitas;
DROP POLICY IF EXISTS "visitas_equipe_editar" ON equipe_visitas;
DROP POLICY IF EXISTS "visitas_equipe_apagar" ON equipe_visitas;
-- Cada um vê as suas; a chefia vê todas
CREATE POLICY "visitas_equipe_ver" ON equipe_visitas FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR eh_chefia());
-- Só registra para si e sempre como pendente
CREATE POLICY "visitas_equipe_registrar" ON equipe_visitas FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pendente' AND payment_id IS NULL);
-- Corrige/apaga só enquanto está pendente (aprovar e recusar é pelas funções abaixo)
CREATE POLICY "visitas_equipe_editar" ON equipe_visitas FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pendente') WITH CHECK (user_id = auth.uid() AND status = 'pendente' AND payment_id IS NULL);
CREATE POLICY "visitas_equipe_apagar" ON equipe_visitas FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pendente');

-- ── 4. Aprovar (vira lançamento) e recusar — só a chefia ────────────────
CREATE OR REPLACE FUNCTION aprovar_visita_equipe(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v     equipe_visitas%ROWTYPE;
  quem  user_profiles%ROWTYPE;
  cli   text;
  vence date;
  pid   uuid;
BEGIN
  IF NOT eh_chefia() THEN RAISE EXCEPTION 'Só a chefia aprova visita.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM equipe_visitas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visita não encontrada.'; END IF;
  IF v.status <> 'pendente' THEN RAISE EXCEPTION 'Essa visita já foi decidida.'; END IF;
  SELECT * INTO quem FROM user_profiles WHERE id = v.user_id;
  SELECT name INTO cli FROM clients WHERE id = v.client_id;
  -- Regra da consultoria: 1ª quinzena vence dia 20; 2ª quinzena, dia 8 do mês seguinte
  vence := CASE WHEN extract(day FROM v.data) <= 15
                THEN (date_trunc('month', v.data) + interval '19 days')::date
                ELSE (date_trunc('month', v.data) + interval '1 month' + interval '7 days')::date END;
  INSERT INTO payments (description, amount, due_date, status, recurrence, category,
                        employee_id, client_id, type, reference_month, origem)
  VALUES ('Visita – ' || quem.full_name || coalesce(' (' || cli || ')', '') || ' – ' || to_char(v.data, 'DD/MM/YYYY'),
          v.valor, vence, 'Pendente', 'Único', 'Outro',
          quem.employee_id, v.client_id, 'Manual', to_char(v.data, 'YYYY-MM'), 'visita_equipe')
  RETURNING id INTO pid;
  UPDATE equipe_visitas
     SET status = 'aprovada', decidido_por = auth.uid(), decidido_em = now(), payment_id = pid, motivo_recusa = NULL
   WHERE id = p_id;
  RETURN pid;
END$$;

CREATE OR REPLACE FUNCTION recusar_visita_equipe(p_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT eh_chefia() THEN RAISE EXCEPTION 'Só a chefia recusa visita.' USING ERRCODE = '42501'; END IF;
  UPDATE equipe_visitas
     SET status = 'recusada', motivo_recusa = nullif(btrim(coalesce(p_motivo, '')), ''),
         decidido_por = auth.uid(), decidido_em = now()
   WHERE id = p_id AND status = 'pendente';
  IF NOT FOUND THEN RAISE EXCEPTION 'Visita não encontrada ou já decidida.'; END IF;
END$$;

REVOKE ALL ON FUNCTION aprovar_visita_equipe(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION recusar_visita_equipe(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION aprovar_visita_equipe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION recusar_visita_equipe(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência: quem da equipe ficou ligado a um cadastro de colaborador
SELECT u.full_name AS login, u.role AS papel, e.full_name AS cadastro_de_colaborador
  FROM user_profiles u LEFT JOIN employees e ON e.id = u.employee_id
 ORDER BY u.full_name;
