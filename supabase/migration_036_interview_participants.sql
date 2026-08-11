-- ============================================================
-- Migration 036 — Múltiplos participantes no Compromisso/Agenda
-- ------------------------------------------------------------
-- Antes só dava pra marcar UM responsável por reunião. Agora dá
-- pra marcar várias pessoas do RH — cada uma vê o compromisso na
-- própria agenda. recruiter_id continua existindo (primeira pessoa
-- da lista) só pra manter compatibilidade com o que já usa esse campo.
-- ============================================================

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS participant_ids UUID[] DEFAULT '{}';

-- Preenche quem já tinha um responsável definido
UPDATE interviews SET participant_ids = ARRAY[recruiter_id]
WHERE recruiter_id IS NOT NULL AND (participant_ids IS NULL OR participant_ids = '{}');

NOTIFY pgrst, 'reload schema';
