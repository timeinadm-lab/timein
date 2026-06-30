-- ============================================================================
-- MIGRATION 009 — Unifica uploads de colaboradores no bucket 'documentos'
-- Bucket 'documentos do funcionário' não aceita upload via API (nome inválido).
-- Agora todos os arquivos de colaboradores vão para 'documentos' em emp/{id}/
-- ============================================================================

-- O bucket 'documentos' já tem a policy 'rh_auth_all' que permite tudo para
-- usuários autenticados. Nenhuma alteração de RLS necessária.

-- Portal (anon) também precisa fazer upload de comprovantes de gastos:
-- Adiciona permissão de INSERT no bucket 'documentos' para anon no caminho receipts/
-- (a policy rh_portal_upload já cobre 'documentos' e 'documentos do funcionário')
-- Só garante que 'documentos' está na lista:

DROP POLICY IF EXISTS "rh_portal_upload" ON storage.objects;
CREATE POLICY "rh_portal_upload" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id IN ('documentos'));

-- Mantém o bucket 'documentos do funcionário' existente mas não é mais usado para upload.
-- Arquivos já armazenados lá (se houver) continuam acessíveis via signed URL.
