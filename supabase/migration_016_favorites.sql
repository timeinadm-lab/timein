-- =====================================================================
-- migration_016_favorites.sql
-- Favoritar colaboradores
-- Execute no Supabase SQL Editor
-- =====================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
