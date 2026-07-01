-- Migration 022 — Férias/eventos de período na Agenda
-- Rode no SQL Editor do Supabase

-- 1. Vincula evento a um colaborador (férias, licença, etc.)
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

-- 2. Data de fim para eventos de período (férias: de X até Y)
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS end_date DATE;
