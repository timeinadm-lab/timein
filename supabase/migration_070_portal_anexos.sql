-- ============================================================
-- Migration 070 — Portal consegue anexar arquivos
-- ------------------------------------------------------------
-- A conferência de 30/09 mostrou: nenhum comprovante, relatório ou atestado
-- enviado pelo portal chegou ao armazenamento. O portal envia para a pasta
-- 'arquivos', mas a nutricionista (acesso anônimo) só tinha permissão de
-- enviar para 'documentos'.
--
-- Libera SÓ o envio (não ler, não apagar, não listar) e SÓ nas pastas do
-- portal: receipts/ (comprovante), relatorios/ e atestados/.
-- O RH continua abrindo os arquivos pelo sistema (link temporário).
-- Pode rodar mais de uma vez.
-- ============================================================

DROP POLICY IF EXISTS "portal_anexos_envio" ON storage.objects;
CREATE POLICY "portal_anexos_envio" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'arquivos' AND (storage.foldername(name))[1] IN ('receipts', 'relatorios', 'atestados'));

-- RH logado abre os anexos (garantia; se já tinha, não muda nada)
DROP POLICY IF EXISTS "rh_le_arquivos" ON storage.objects;
CREATE POLICY "rh_le_arquivos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'arquivos');

-- Conferência: deve listar as duas regras
SELECT policyname AS regra, cmd AS acao, array_to_string(roles, ',') AS quem
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname IN ('portal_anexos_envio', 'rh_le_arquivos');
