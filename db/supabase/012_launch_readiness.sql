-- 012_launch_readiness.sql
--
-- P0 launch-readiness migration: idempotency, real treasury_actors mapping,
-- webhook replay protection, outbox pattern, sanctions screening, FORCE RLS.
--
-- Idempotent: every statement is `IF NOT EXISTS` / `IF EXISTS`. Safe to apply
-- to dev / staging / prod in any order.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. treasury_actors ↔ Supabase user UUID mapping (replaces unsafe hash).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE treasury_actors
  ADD COLUMN IF NOT EXISTS user_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS treasury_actors_user_uuid_uidx
  ON treasury_actors(user_uuid)
  WHERE user_uuid IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Idempotency keys on every financial write.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE disbursement_orders
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(128);
CREATE UNIQUE INDEX IF NOT EXISTS disbursement_orders_idem_uidx
  ON disbursement_orders(actor_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(128);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_idem_uidx
  ON ledger_entries(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(128);
CREATE UNIQUE INDEX IF NOT EXISTS deals_idem_uidx
  ON deals(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Partial unique on (transaction_id) so postEntry called twice for the
-- same logical transaction cannot double-post within a single account.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_txn_account_uidx
  ON ledger_entries(transaction_id, ledger_account_id)
  WHERE reversal_of IS NULL;

-- Composite index used by the rolling-window query.
CREATE INDEX IF NOT EXISTS disbursement_orders_actor_status_created_idx
  ON disbursement_orders(actor_id, status, created_at);

-- Optimistic lock columns for row-version checks on status transitions.
ALTER TABLE disbursement_orders
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Webhook events — replay protection + audit per inbound provider call.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id          bigserial PRIMARY KEY,
  provider    varchar(64) NOT NULL,
  event_id    varchar(255) NOT NULL,
  signature   varchar(512) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status      varchar(32) NOT NULL DEFAULT 'received',
  payload     jsonb NOT NULL,
  error       text,
  CONSTRAINT webhook_events_provider_event_uidx UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_status_idx
  ON webhook_events(status);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Outbox — at-least-once delivery for outbound provider calls.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbox_events (
  id            bigserial PRIMARY KEY,
  aggregate     varchar(64) NOT NULL,
  aggregate_id  varchar(64) NOT NULL,
  event_type    varchar(128) NOT NULL,
  payload       jsonb NOT NULL,
  status        varchar(32) NOT NULL DEFAULT 'pending',
  attempts      integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_events_status_next_idx
  ON outbox_events(status, next_attempt_at)
  WHERE status IN ('pending', 'retrying');

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Sanctions / PEP screening results.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sanctions_screenings (
  id           bigserial PRIMARY KEY,
  user_uuid    uuid,
  recipient_hash varchar(128),
  list_name    varchar(64) NOT NULL,
  match_score  numeric(5,2) NOT NULL,
  outcome      varchar(32) NOT NULL,         -- clear | review | block | error
  provider     varchar(64) NOT NULL,
  raw_response jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sanctions_screenings_user_idx
  ON sanctions_screenings(user_uuid);
CREATE INDEX IF NOT EXISTS sanctions_screenings_outcome_idx
  ON sanctions_screenings(outcome);
CREATE INDEX IF NOT EXISTS sanctions_screenings_recipient_idx
  ON sanctions_screenings(recipient_hash);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. FORCE ROW LEVEL SECURITY on PII / financial tables.
-- The service-role key bypasses RLS by default; FORCE makes RLS apply
-- even to that role unless explicitly granted BYPASSRLS at the role level.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  protected_tables text[] := ARRAY[
    'profiles','accounts','transactions','budgets','goals',
    'recurring_bills','splits','cash_envelopes','transaction_categories',
    'ledger_accounts','ledger_entries','disbursement_orders','deals',
    'treasury_accounts','treasury_actors','treasury_audit_logs',
    'audit_log','sanctions_screenings','webhook_events','outbox_events'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. current_user_id() now resolves Supabase UUIDs (not legacy firebase_uid).
-- The previous version returned NULL for native Supabase signups, silently
-- defeating every per-user RLS policy.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.user_id', true), '')::uuid,
    auth.uid()
  )
$$;

COMMIT;
