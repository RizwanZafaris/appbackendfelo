-- 004_accounts_metadata.sql
-- Add type + sync_status columns so the Flutter `FeloAccount` model
-- round-trips losslessly. Both columns are nullable / defaulted so the
-- migration is non-destructive against existing rows.
--
-- Idempotent: safe to run multiple times. Uses IF NOT EXISTS on the
-- column adds and leverages CHECK constraint redefinition via DO block.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS type TEXT
    CHECK (type IS NULL OR type IN ('bank', 'card', 'wallet'));

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced'
    CHECK (sync_status IN ('synced', 'syncing', 'needs_review'));

COMMENT ON COLUMN public.accounts.type IS
  'Display category: bank, card, wallet. Nullable for legacy rows.';
COMMENT ON COLUMN public.accounts.sync_status IS
  'Aggregator sync state. Defaults to synced for manually-added accounts.';
