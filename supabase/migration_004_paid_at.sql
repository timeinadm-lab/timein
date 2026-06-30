-- migration_004_paid_at.sql
-- Run in Supabase SQL Editor

-- 1. Add paid_at timestamp to payments (when it was marked as paid)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- 2. Backfill: for already-paid payments, set paid_at = updated_at if available
UPDATE payments
  SET paid_at = updated_at
  WHERE status = 'Pago' AND paid_at IS NULL AND updated_at IS NOT NULL;
