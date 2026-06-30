-- migration_003_expenses.sql
-- Run in Supabase SQL Editor

-- 1. Employee expenses (reembolsos, ajuda de custo, etc.)
CREATE TABLE IF NOT EXISTS employee_expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'Reembolso',
  reference_month TEXT,           -- '2026-06'
  receipt_url TEXT,               -- comprovante uploaded
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Cost assistance per link (ajuda de custo mensal fixa no contrato)
ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS cost_assistance DECIMAL(10,2) DEFAULT 0;

-- 3. Disable RLS
ALTER TABLE employee_expenses DISABLE ROW LEVEL SECURITY;
