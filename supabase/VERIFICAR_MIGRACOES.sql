-- ============================================================
-- VERIFICAR MIGRAÇÕES — não altera nada, só olha e responde
-- ------------------------------------------------------------
-- Cole no SQL Editor do Supabase e rode. A tabela devolvida diz,
-- linha por linha, o que já está no banco e o que falta rodar.
-- As que faltarem aparecem primeiro, com o número do arquivo.
-- ============================================================

WITH checagem AS (

  -- ── Colunas ──────────────────────────────────────────────
  SELECT 'Agenda: tipo do compromisso (Reunião/Compromisso/Visita)' AS item, '034' AS migracao,
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='interviews' AND column_name='category') AS ok
  UNION ALL
  SELECT 'Agenda: compromisso pode ficar sem data', '033',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='interviews'
                   AND column_name='scheduled_at' AND is_nullable='YES')
  UNION ALL
  SELECT 'Agenda: cliente da visita', '035',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='interviews' AND column_name='client_id')
  UNION ALL
  SELECT 'Agenda: mês de referência (prazo pra agendar)', '035',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='interviews' AND column_name='target_month')
  UNION ALL
  SELECT 'Agenda: vários participantes na reunião', '036',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='interviews' AND column_name='participant_ids')
  UNION ALL
  SELECT 'Agenda: compromisso de colaborador', '022',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='interviews' AND column_name='employee_id')
  UNION ALL
  SELECT 'Meu Perfil: foto do usuário', '038',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='user_profiles' AND column_name='photo_url')
  UNION ALL
  SELECT 'Vínculo: exige contrato?', '042',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employee_client_links' AND column_name='contract_required')
  UNION ALL
  SELECT 'Vínculo: prazo em horas pro contrato', '042',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employee_client_links' AND column_name='contract_deadline')
  UNION ALL
  SELECT 'Documento do colaborador: data de validade', '042',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employee_documents' AND column_name='expires_at')
  UNION ALL
  SELECT 'Documento compartilhado: data de validade', '042',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='shared_documents' AND column_name='expires_at')
  UNION ALL
  SELECT 'Cliente: meta de colaboradores', '043',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='clients' AND column_name='target_employees')
  UNION ALL
  SELECT 'Pagamento ligado ao vínculo', '024',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='payments' AND column_name='link_id')

  -- ── Tabelas ──────────────────────────────────────────────
  UNION ALL
  SELECT 'Financeiro: lançamentos', '030',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='financial_entries')
  UNION ALL
  SELECT 'Financeiro: confirmações', '031',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='financial_confirmations')

  -- ── Funções do portal ────────────────────────────────────
  UNION ALL
  SELECT 'Portal: valor da visita calculado no servidor', '041',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname='portal_calc_visit_rate')
  UNION ALL
  SELECT 'Portal: gravar visita pelo servidor', '041',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname='portal_save_visit')
  UNION ALL
  SELECT 'Portal: trocar dia da agenda', '044',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname='portal_trocar_dia_agenda')
  UNION ALL
  -- A versão certa precisa ter as TRÊS coisas ao mesmo tempo: senha com hash,
  -- bloqueio por tentativas e a trava de contrato. Faltando qualquer uma, é
  -- versão antiga — e foi isso que derrubou o login de quem tinha senha nova.
  SELECT 'Portal: login com senha nova (hash) + bloqueio + trava de contrato', '045',
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname='portal_login'
                   AND pg_get_functiondef(p.oid) LIKE '%portal_pin_hash%'
                   AND pg_get_functiondef(p.oid) LIKE '%portal_login_attempts%'
                   AND pg_get_functiondef(p.oid) LIKE '%contract_required%')
  UNION ALL
  SELECT 'Portal: redefinir senha destrava quem errou 5 vezes', '046',
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname='portal_set_pin'
                   AND pg_get_functiondef(p.oid) LIKE '%portal_login_attempts%')
)

SELECT
  CASE WHEN ok THEN 'OK' ELSE '>>> FALTA RODAR' END AS situacao,
  migracao AS arquivo,
  item
FROM checagem
ORDER BY ok ASC, migracao ASC;
