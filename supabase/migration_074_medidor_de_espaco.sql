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

-- Conferência: mostra o uso de agora
SELECT uso_do_sistema();
