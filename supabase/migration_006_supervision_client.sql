-- migration_006_supervision_client.sql
-- Add client_id to supervision_visits so we can track visits per client
-- (previously tracked per contract, but contracts rarely have requires_supervision set)

ALTER TABLE supervision_visits
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE;

-- Backfill: attempt to derive client_id from existing contract links
UPDATE supervision_visits sv
  SET client_id = c.client_id
  FROM contracts c
  WHERE sv.contract_id = c.id AND sv.client_id IS NULL;
