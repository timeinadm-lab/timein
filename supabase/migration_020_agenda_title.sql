-- Migration 020 — Agenda genérica: adiciona título ao evento
-- Rode no SQL Editor do Supabase

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS title TEXT;

-- Preenche títulos em entrevistas existentes (usando nome do candidato)
UPDATE interviews i
SET title = 'Entrevista — ' || COALESCE(c.full_name, 'Candidato')
FROM candidates c
WHERE i.candidate_id = c.id AND i.title IS NULL;

-- Eventos sem candidato ficam com título genérico
UPDATE interviews SET title = 'Compromisso' WHERE title IS NULL;
