-- Migration 021 — Remove status "Desligado", adiciona "Ocioso"
-- Rode no SQL Editor do Supabase

-- 1. Converte todos os "Desligado" para "Inativo"
UPDATE employees SET status = 'Inativo' WHERE status = 'Desligado';

-- 2. Remove constraint antiga e cria nova (Ativo, Inativo, Ocioso)
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_status_check
  CHECK (status IN ('Ativo', 'Inativo', 'Ocioso'));
