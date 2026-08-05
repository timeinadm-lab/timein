-- ============================================================
-- Migration 033 — compromisso "sem data" (a agendar)
-- ------------------------------------------------------------
-- Permite criar um compromisso/auditoria SEM data definida, pra
-- pessoa do RH ficar ciente de que precisa fazer, mesmo sem o dia.
-- scheduled_at = NULL  ==  "a agendar". Quando a data for definida,
-- vira um compromisso normal no calendário/agenda.
-- ============================================================

ALTER TABLE interviews ALTER COLUMN scheduled_at DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
