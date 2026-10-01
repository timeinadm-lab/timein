-- ============================================================
-- MIGRAÇÕES PENDENTES 072 a 076 — rodar tudo de uma vez.
-- Pode rodar mesmo que alguma já tenha rodado: nenhuma apaga ou muda dado.
-- No fim aparece a conferência de TODAS as migrações de 062 a 076.
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>> migration_072_recalcular_visita_sem_valor <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- Migration 072 — Visita registrada SEM VALOR pode ser recalculada pelo RH
-- ------------------------------------------------------------
-- Achado na conferência de pagamentos (30/09/2026): visita de consultoria
-- registrada quando o cliente/unidade ainda não tinha preço por visita fica
-- com valor vazio para sempre — e o pagamento sai sem ela, sem aviso.
--
-- Agora: o RH coloca o preço na unidade do cliente (ou no vínculo) e, em
-- Pagamentos, clica "Recalcular". A conta é a MESMA do portal
-- (portal_calc_visit_rate: preço da unidade, proporcional às horas
-- combinadas por visita).
--
-- Só mexe em visita SEM valor. Nunca muda visita que já tem valor, nem
-- extra aguardando aprovação ou negado, nem falta/folga.
-- Visita sem unidade: se o cliente tem UMA só unidade com preço, usa ela.
-- ============================================================

CREATE OR REPLACE FUNCTION rh_recalcular_visitas_sem_valor(
  p_employee uuid, p_client uuid, p_ini date, p_fim date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        record;
  v_unit   uuid;
  v_valor  numeric;
  v_ok     int := 0;
  v_sem    int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'Só o RH logado pode recalcular.' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT * FROM nutritionist_visits v
     WHERE v.employee_id = p_employee AND v.client_id = p_client
       AND v.visit_date BETWEEN p_ini AND p_fim
       AND coalesce(v.visit_rate, 0) = 0
       AND v.check_in IS NOT NULL AND v.check_out IS NOT NULL
       AND NOT coalesce(v.is_unavailable, false)
       AND NOT coalesce(v.is_holiday, false)
       AND v.extra_approval IS DISTINCT FROM 'pendente'
       AND v.extra_approval IS DISTINCT FROM 'negada'
  LOOP
    v_unit := coalesce(r.unit_id, (
      SELECT min(u.id::text)::uuid FROM client_units u
       WHERE u.client_id = r.client_id AND coalesce(u.visit_rate, 0) > 0
      HAVING count(*) = 1));

    v_valor := portal_calc_visit_rate(
      r.employee_id, r.client_id, v_unit, r.visit_date,
      r.check_in::time, r.check_out::time,
      nullif(btrim(coalesce(r.break_start::text, '')), '')::time,
      nullif(btrim(coalesce(r.break_end::text, '')), '')::time);

    IF coalesce(v_valor, 0) > 0 THEN
      UPDATE nutritionist_visits SET visit_rate = v_valor WHERE id = r.id;
      v_ok := v_ok + 1;
    ELSE
      v_sem := v_sem + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('corrigidas', v_ok, 'sem_preco', v_sem);
END$$;

REVOKE ALL ON FUNCTION rh_recalcular_visitas_sem_valor(uuid, uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION rh_recalcular_visitas_sem_valor(uuid, uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>> migration_073_jornada_historico_e_ajuste_manual <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- Migration 073 — Histórico da Jornada + lançamento ajustado à mão
-- ------------------------------------------------------------
-- Pedido do Gabriel (01/10/2026):
--   1. A Jornada de cada colaborador gera um PDF do mês que fica SALVO no
--      histórico (quem salvou, quando, os números daquele momento).
--   2. Vínculo e salário podem ser editados a qualquer hora e o pagamento
--      ainda não pago tem que acompanhar o valor novo. O sistema passa a
--      atualizar sozinho o lançamento PENDENTE — menos o que o RH ajustou
--      à mão ("Ajustar lançamento"), que fica marcado e não é mexido.
-- Não altera nenhum valor existente. Pode rodar mais de uma vez.
-- ============================================================

-- ── 1. Histórico da Jornada ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jornada_historico (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  mes         text NOT NULL CHECK (mes ~ '^\d{4}-\d{2}$'),   -- yyyy-MM
  arquivo     text NOT NULL,                                 -- caminho no armazenamento (pasta 'arquivos')
  resumo      jsonb,                                         -- números do mês no momento em que foi salvo
  criado_por  uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jornada_historico_pessoa_mes ON jornada_historico (employee_id, mes);

ALTER TABLE jornada_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rh_jornada_historico" ON jornada_historico;
CREATE POLICY "rh_jornada_historico" ON jornada_historico FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── 2. Lançamento ajustado à mão ─────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ajuste_manual boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>> migration_074_medidor_de_espaco <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- Migration 074 — Medidor de espaço do plano gratuito do Supabase
-- ------------------------------------------------------------
-- Pedido do Gabriel (01/10/2026): um medidor no Dashboard mostrando quanto
-- dos limites do plano gratuito já foi usado:
--   · Arquivos (relatórios, comprovantes, contratos, fotos): 1 GB
--   · Banco de dados: 500 MB
-- Passando do limite, o Supabase pode restringir o PROJETO INTEIRO (sistema e
-- portal param juntos), então o medidor avisa com antecedência.
--
-- Só LÊ: tamanho do banco, soma dos arquivos, o que entrou nos últimos 30 dias
-- (para calcular em quanto tempo lota) e o tamanho de cada pasta.
-- Só para quem está logado no sistema (RH); o portal não vê.
-- ============================================================

CREATE OR REPLACE FUNCTION uso_do_sistema() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'banco_bytes', pg_database_size(current_database()),
    'arquivos_bytes', coalesce((SELECT sum((o.metadata->>'size')::bigint) FROM storage.objects o), 0),
    'arquivos_qtd', (SELECT count(*) FROM storage.objects),
    'ultimos_30_dias_bytes', coalesce((
      SELECT sum((o.metadata->>'size')::bigint) FROM storage.objects o
       WHERE o.created_at > now() - interval '30 days'), 0),
    'por_pasta', coalesce((
      SELECT jsonb_agg(jsonb_build_object('pasta', t.pasta, 'bytes', t.bytes, 'qtd', t.qtd) ORDER BY t.bytes DESC)
        FROM (
          SELECT o.bucket_id || '/' || CASE WHEN position('/' in o.name) > 0 THEN split_part(o.name, '/', 1) ELSE '(raiz)' END AS pasta,
                 coalesce(sum((o.metadata->>'size')::bigint), 0) AS bytes,
                 count(*) AS qtd
            FROM storage.objects o
           GROUP BY 1
        ) t), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION uso_do_sistema() FROM public, anon;
GRANT EXECUTE ON FUNCTION uso_do_sistema() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>> migration_075_caixa_da_equipe <<<<<<<<<<<<<<<<<<<<
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


-- >>>>>>>>>>>>>>>>>>>> migration_076_visita_paga_da_equipe <<<<<<<<<<<<<<<<<<<<
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

-- ============================================================
-- CONFERÊNCIA — o que já rodou (OK) e o que falta (FALTA RODAR)
-- ============================================================
SELECT m.migracao, CASE WHEN m.ok THEN 'OK' ELSE 'FALTA RODAR' END AS situacao
  FROM (VALUES
    ('062 – horas acima do combinado',          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nutritionist_visits' AND column_name = 'excesso_status')),
    ('063 – unidade na supervisão',             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'supervision_visits' AND column_name = 'unit_id')),
    ('064 – unidades do cliente',               EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'valor_da_unidade')),
    ('065 – falta e folga na consultoria',      EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'visita_sem_valor_em_falta')),
    ('066 – vários colaboradores no compromisso', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'interviews' AND column_name = 'employee_ids')),
    ('067 – jornada e horário',                 EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_client_links' AND column_name = 'break_minutes')),
    ('068 – revisão do portal',                 EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'vinculo_recebe_mensal')),
    ('069 – CPF só números e trocar senha',     EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'portal_trocar_senha')),
    ('070 – anexos do portal',                  EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'portal_anexos_envio')),
    ('072 – recalcular visita sem valor',       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rh_recalcular_visitas_sem_valor')),
    ('073 – histórico da jornada',              EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'jornada_historico')),
    ('074 – medidor de espaço',                 EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uso_do_sistema')),
    ('075 – caixa da equipe',                   EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipe_caixa')),
    ('076 – visita paga da equipe',             EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipe_visitas'))
  ) AS m(migracao, ok)
 ORDER BY 1;
