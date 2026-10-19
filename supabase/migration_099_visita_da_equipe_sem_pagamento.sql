-- ============================================================
-- Migration 099 — Visita, supervisão e vistoria da equipe SEM pagamento
-- ------------------------------------------------------------
-- Pedido do Gabriel (19/10/2026): quem é do administrativo também faz
-- supervisão, vistoria e visita. Quer registrar como no portal (cliente,
-- unidade, entrada e saída), mas SEM ganhar por isso: não calcula nada,
-- só entra no relatório semanal e no calendário.
--
-- A visita paga (076/078) continua igual: valor, aprovação da contabilidade
-- e lançamento em Pagamentos. A não paga:
--   · paga = false, sem valor, status 'registrada' (não passa por aprovação
--     e nunca vira lançamento);
--   · tipo: visita, supervisão ou vistoria (vale para as duas).
-- Cada um continua vendo só o seu (a contabilidade vê todos — 078).
-- Não apaga nem muda nenhum dado: o que já existe fica paga = true, tipo visita.
-- Pode rodar mais de uma vez.
-- ============================================================

-- ── 1. Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE equipe_visitas ADD COLUMN IF NOT EXISTS paga boolean NOT NULL DEFAULT true;
ALTER TABLE equipe_visitas ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'visita';

-- ── 2. Regras: valor só na paga; 'registrada' só na não paga ────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'equipe_visitas'::regclass AND contype = 'c' LOOP
    IF c.def ILIKE '%valor%' OR c.def ILIKE '%status%' OR c.def ILIKE '%tipo%' THEN
      EXECUTE format('ALTER TABLE equipe_visitas DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END$$;
ALTER TABLE equipe_visitas ALTER COLUMN valor DROP NOT NULL;
ALTER TABLE equipe_visitas ADD CONSTRAINT equipe_visitas_valor_ok
  CHECK ((paga AND valor > 0) OR (NOT paga AND valor IS NULL));
ALTER TABLE equipe_visitas ADD CONSTRAINT equipe_visitas_status_ok
  CHECK (status IN ('pendente', 'aprovada', 'recusada', 'registrada') AND (NOT paga) = (status = 'registrada'));
ALTER TABLE equipe_visitas ADD CONSTRAINT equipe_visitas_tipo_ok
  CHECK (tipo IN ('visita', 'supervisao', 'vistoria'));

-- ── 3. Quem pode o quê (dono; a não paga se corrige e apaga como a pendente) ──
DROP POLICY IF EXISTS "visitas_equipe_registrar" ON equipe_visitas;
DROP POLICY IF EXISTS "visitas_equipe_editar" ON equipe_visitas;
DROP POLICY IF EXISTS "visitas_equipe_apagar" ON equipe_visitas;
CREATE POLICY "visitas_equipe_registrar" ON equipe_visitas FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND payment_id IS NULL
              AND status = CASE WHEN paga THEN 'pendente' ELSE 'registrada' END);
CREATE POLICY "visitas_equipe_editar" ON equipe_visitas FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status IN ('pendente', 'registrada'))
  WITH CHECK (user_id = auth.uid() AND payment_id IS NULL
              AND status = CASE WHEN paga THEN 'pendente' ELSE 'registrada' END);
CREATE POLICY "visitas_equipe_apagar" ON equipe_visitas FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status IN ('pendente', 'registrada'));

-- ── 4. Aprovar: nunca uma visita não paga ────────────────────────────────
CREATE OR REPLACE FUNCTION aprovar_visita_equipe(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v     equipe_visitas%ROWTYPE;
  quem  user_profiles%ROWTYPE;
  cli   text;
  vence date;
  pid   uuid;
BEGIN
  IF NOT eh_contabilidade() THEN RAISE EXCEPTION 'Só a contabilidade aprova visita.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM equipe_visitas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visita não encontrada.'; END IF;
  IF NOT v.paga THEN RAISE EXCEPTION 'Visita não paga não vai para Pagamentos.'; END IF;
  IF v.status <> 'pendente' THEN RAISE EXCEPTION 'Essa visita já foi decidida.'; END IF;
  IF v.data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Essa visita ainda não aconteceu. Aprove depois do dia dela.';
  END IF;
  SELECT * INTO quem FROM user_profiles WHERE id = v.user_id;
  SELECT name INTO cli FROM clients WHERE id = v.client_id;
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
REVOKE ALL ON FUNCTION aprovar_visita_equipe(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION aprovar_visita_equipe(uuid) TO authenticated;

-- ── 5. Modelos de visita também sem valor (para repetir a não paga) ─────
ALTER TABLE equipe_modelos_visita ADD COLUMN IF NOT EXISTS paga boolean NOT NULL DEFAULT true;
ALTER TABLE equipe_modelos_visita ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'visita';
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'equipe_modelos_visita'::regclass AND contype = 'c' LOOP
    IF c.def ILIKE '%valor%' OR c.def ILIKE '%tipo%' THEN
      EXECUTE format('ALTER TABLE equipe_modelos_visita DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END$$;
ALTER TABLE equipe_modelos_visita ALTER COLUMN valor DROP NOT NULL;
ALTER TABLE equipe_modelos_visita ADD CONSTRAINT equipe_modelos_valor_ok
  CHECK ((paga AND valor > 0) OR (NOT paga AND valor IS NULL));
ALTER TABLE equipe_modelos_visita ADD CONSTRAINT equipe_modelos_tipo_ok
  CHECK (tipo IN ('visita', 'supervisao', 'vistoria'));

NOTIFY pgrst, 'reload schema';

-- Conferência: visitas da equipe por tipo e se é paga
SELECT tipo, paga, status, count(*) AS quantas FROM equipe_visitas GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
