-- ============================================================
-- Migration 078 — Equipe: cada um vê o seu; só a contabilidade vê todos
-- ------------------------------------------------------------
-- Pedido do Gabriel (02/10/2026): na Equipe, ninguém abre o trabalho do
-- outro (nem o chefe). Só a contabilidade vê todos e aprova as visitas.
-- E cada um guarda "modelos" de visita (cliente, unidade, valor, horário)
-- para programar de novo em outro dia sem digitar tudo.
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION eh_contabilidade() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'contabilidade')
$$;
REVOKE ALL ON FUNCTION eh_contabilidade() FROM public, anon;
GRANT EXECUTE ON FUNCTION eh_contabilidade() TO authenticated;

-- Caixa e visitas: dono vê o seu; contabilidade vê todos
DROP POLICY IF EXISTS "caixa_ver" ON equipe_caixa;
CREATE POLICY "caixa_ver" ON equipe_caixa FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR eh_contabilidade());

DROP POLICY IF EXISTS "visitas_equipe_ver" ON equipe_visitas;
CREATE POLICY "visitas_equipe_ver" ON equipe_visitas FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR eh_contabilidade());

-- Aprovar / recusar: só a contabilidade
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

CREATE OR REPLACE FUNCTION recusar_visita_equipe(p_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT eh_contabilidade() THEN RAISE EXCEPTION 'Só a contabilidade recusa visita.' USING ERRCODE = '42501'; END IF;
  UPDATE equipe_visitas
     SET status = 'recusada', motivo_recusa = nullif(btrim(coalesce(p_motivo, '')), ''),
         decidido_por = auth.uid(), decidido_em = now()
   WHERE id = p_id AND status = 'pendente';
  IF NOT FOUND THEN RAISE EXCEPTION 'Visita não encontrada ou já decidida.'; END IF;
END$$;

-- Modelos de visita: cada um vê e mexe só nos seus
CREATE TABLE IF NOT EXISTS equipe_modelos_visita (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  unidade     text,
  valor       numeric(10,2) NOT NULL CHECK (valor > 0),
  entrada     time,
  saida       time,
  observacoes text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipe_modelos_pessoa ON equipe_modelos_visita (user_id);
ALTER TABLE equipe_modelos_visita ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "modelos_do_dono" ON equipe_modelos_visita;
CREATE POLICY "modelos_do_dono" ON equipe_modelos_visita FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Trava da 077 (só equipe liberada) também na tabela nova, se a 077 já rodou
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
    DROP POLICY IF EXISTS so_equipe ON equipe_modelos_visita;
    CREATE POLICY so_equipe ON equipe_modelos_visita AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()));
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência: quem é contabilidade (só essas pessoas veem a equipe toda)
SELECT full_name AS nome, email, role AS papel FROM user_profiles WHERE role = 'contabilidade' ORDER BY full_name;
