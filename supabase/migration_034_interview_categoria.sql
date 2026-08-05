-- ============================================================
-- Migration 034 — tipo do compromisso (Reunião, Visita, etc.)
-- ------------------------------------------------------------
-- A Agenda servia só pra reunião/treino/ligação. Agora cada
-- compromisso pode ter um TIPO — inclusive "Visita" — pra pessoa
-- saber que aquilo é uma visita a fazer, não só uma reunião.
-- Coluna livre (sem constraint) pra não travar tipos novos no futuro.
-- ============================================================

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS category TEXT;

NOTIFY pgrst, 'reload schema';
