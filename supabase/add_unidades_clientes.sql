-- =====================================================================
-- add_unidades_clientes.sql
-- Cria uma unidade para cada cliente, com o MESMO nome do cliente.
-- Ex.: cliente "AMÉRICA" → unidade "AMÉRICA".
-- Só cria se o cliente ainda não tiver uma unidade com esse nome (idempotente).
-- Cole no SQL Editor do Supabase e rode.
-- =====================================================================

INSERT INTO client_units (client_id, name)
SELECT c.id, c.name
FROM clients c
WHERE NOT EXISTS (
  SELECT 1 FROM client_units u
  WHERE u.client_id = c.id
    AND lower(trim(u.name)) = lower(trim(c.name))
);

NOTIFY pgrst, 'reload schema';
