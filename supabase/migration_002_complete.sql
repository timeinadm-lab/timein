-- ============================================================
-- TIME IN — MIGRATION 002: Campos completos + Pagamentos
-- Execute no SQL Editor do Supabase Dashboard
-- ============================================================

-- ── 1. EMPLOYEES: novos campos ───────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS rg                   TEXT,
  ADD COLUMN IF NOT EXISTS phone                TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone      TEXT,
  ADD COLUMN IF NOT EXISTS address_street       TEXT,
  ADD COLUMN IF NOT EXISTS address_number       TEXT,
  ADD COLUMN IF NOT EXISTS address_neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS address_city         TEXT,
  ADD COLUMN IF NOT EXISTS address_zip          TEXT;

-- ── 2. PAYMENTS: vincular ao colaborador + tipo ──────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type            TEXT DEFAULT 'Manual' CHECK (type IN ('Manual','Estimativa','Real')),
  ADD COLUMN IF NOT EXISTS reference_month TEXT;  -- formato: yyyy-MM

-- ── 3. EMPLOYEE_CLIENT_LINKS: escala de trabalho ─────────────
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS work_schedule TEXT,   -- '5x2','6x1','12x36','Temporário','Plantão'
  ADD COLUMN IF NOT EXISTS expected_days_month INT;

-- ── 4. EMPLOYEE_DOCUMENTS: campo de URL do arquivo ──────────
ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS file_url TEXT;

-- ── 5. DESABILITAR RLS nas novas tabelas/colunas ─────────────
-- (já estão desabilitadas conforme setup anterior)
-- Se precisar, rodar:
-- ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE payments DISABLE ROW LEVEL SECURITY;

-- ── 6. ÍNDICES para performance ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_employee_id ON payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_payments_reference_month ON payments(reference_month);
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
