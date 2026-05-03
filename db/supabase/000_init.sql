-- =====================================================================
-- FELO — Initial database schema for Supabase
-- =====================================================================
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query),
-- or via the Supabase CLI:    supabase db push
--
-- This script is IDEMPOTENT: safe to re-run. It creates:
--   1. Required Postgres extensions (pgcrypto, citext)
--   2. All Felo tables with constraints and indexes
--   3. Row-Level Security (RLS) policies bound to Supabase Auth users
--   4. updated_at triggers
--   5. A `current_user_id()` helper that maps Supabase auth.uid() → felo users.id
--
-- Note: Felo uses Firebase Auth client-side and exchanges a Firebase ID
-- token for a Supabase JWT (or a custom JWT) via the backend. The RLS
-- policies below assume the JWT carries `sub` = users.firebase_uid OR
-- the request supplies `app.user_id` via PGSettings (NestJS path).
-- =====================================================================

-- ---------- 0. Extensions --------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text

-- ---------- 1. Tables -------------------------------------------------

-- USERS
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid    TEXT UNIQUE NOT NULL,
  email           CITEXT UNIQUE NOT NULL,
  display_name    TEXT,
  phone_e164      TEXT,
  corridor        TEXT NOT NULL CHECK (corridor IN ('canada','pakistan','other')),
  language_code   TEXT NOT NULL DEFAULT 'en',
  kyc_status      TEXT NOT NULL DEFAULT 'not_started'
                  CHECK (kyc_status IN ('not_started','in_progress','submitted','approved','rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON public.profiles(firebase_uid);

-- ACCOUNTS
CREATE TABLE IF NOT EXISTS public.accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  display_name    TEXT,
  currency        CHAR(3) NOT NULL,
  balance_minor   BIGINT,
  last_synced_at  TIMESTAMPTZ,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON public.accounts(user_id);

-- TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id        UUID REFERENCES public.accounts(id),
  merchant          TEXT,
  category          TEXT,
  currency          CHAR(3) NOT NULL,
  amount_minor      BIGINT NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  source            TEXT NOT NULL CHECK (source IN ('sms','manual','bank_alert','ocr','import')),
  parser_confidence NUMERIC(3,2),
  booked_at         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  receipt_url       TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_txn_user_booked  ON public.transactions(user_id, booked_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_user_updated ON public.transactions(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_txn_metadata     ON public.transactions USING GIN (metadata);

-- BUDGETS
CREATE TABLE IF NOT EXISTS public.budgets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category                 TEXT NOT NULL,
  currency                 CHAR(3) NOT NULL,
  limit_minor              BIGINT NOT NULL,
  period                   TEXT NOT NULL CHECK (period IN ('weekly','monthly','custom')),
  rollover_enabled         BOOLEAN NOT NULL DEFAULT false,
  alert_threshold_percent  INT NOT NULL DEFAULT 80
                            CHECK (alert_threshold_percent BETWEEN 0 AND 100),
  starts_on                DATE NOT NULL,
  is_archived              BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budgets_user ON public.budgets(user_id);

-- GOALS
CREATE TABLE IF NOT EXISTS public.goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  currency      CHAR(3) NOT NULL,
  target_minor  BIGINT NOT NULL,
  saved_minor   BIGINT NOT NULL DEFAULT 0,
  target_date   DATE,
  cadence       TEXT NOT NULL CHECK (cadence IN ('weekly','monthly','manual')),
  shared        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON public.goals(user_id);

-- FAMILY GROUPS + MEMBERS
CREATE TABLE IF NOT EXISTS public.family_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID NOT NULL REFERENCES public.profiles(id),
  name           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.family_members (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id                     UUID NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  user_id                       UUID NOT NULL REFERENCES public.profiles(id),
  role                          TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  can_view_shared_transactions  BOOLEAN NOT NULL DEFAULT false,
  can_edit_shared_budgets       BOOLEAN NOT NULL DEFAULT false,
  joined_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_family_members_user ON public.family_members(user_id);

-- CONSENT EVENTS (audit ledger)
CREATE TABLE IF NOT EXISTS public.consent_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   UUID NOT NULL,
  subject_user_id UUID NOT NULL,
  resource_type   TEXT,
  resource_id     UUID,
  action          TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_consent_subject ON public.consent_events(subject_user_id, occurred_at DESC);

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('push','email','inapp','sms')),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id) WHERE read_at IS NULL;

-- DEVICES (push tokens)
CREATE TABLE IF NOT EXISTS public.devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token   TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, push_token)
);

-- ---------- 2. updated_at trigger -----------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I; ' ||
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      r.table_name, r.table_name
    );
  END LOOP;
END;
$$;

-- ---------- 3. Helper: current_user_id() ------------------------------
-- Returns the felo users.id of the current request, resolving from either:
--   (a) auth.uid() — Supabase Auth case (uid is stored as users.firebase_uid
--       when we mirror Firebase users into Supabase Auth)
--   (b) current_setting('app.user_id', true) — NestJS backend case where
--       the API gateway sets the felo user uuid per request.
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE
  app_user TEXT;
  resolved UUID;
BEGIN
  -- 1. Backend-set context (NestJS path)
  app_user := current_setting('app.user_id', true);
  IF app_user IS NOT NULL AND app_user <> '' THEN
    RETURN app_user::uuid;
  END IF;

  -- 2. Supabase Auth path: auth.uid() -> users.firebase_uid -> users.id
  IF auth.uid() IS NOT NULL THEN
    SELECT u.id INTO resolved
    FROM public.profiles u
    WHERE u.firebase_uid = auth.uid()::text
    LIMIT 1;
    RETURN resolved;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------- 4. Row-Level Security ------------------------------------
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices         ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate pattern keeps the script idempotent.
DROP POLICY IF EXISTS users_self_rw         ON public.profiles;
DROP POLICY IF EXISTS accounts_owner_rw     ON public.accounts;
DROP POLICY IF EXISTS transactions_owner_rw ON public.transactions;
DROP POLICY IF EXISTS budgets_owner_rw      ON public.budgets;
DROP POLICY IF EXISTS goals_owner_rw        ON public.goals;
DROP POLICY IF EXISTS family_groups_owner   ON public.family_groups;
DROP POLICY IF EXISTS family_members_self   ON public.family_members;
DROP POLICY IF EXISTS consent_events_self   ON public.consent_events;
DROP POLICY IF EXISTS notifications_owner   ON public.notifications;
DROP POLICY IF EXISTS devices_owner         ON public.devices;

-- Users can read and update their own row only.
CREATE POLICY users_self_rw ON public.profiles
  FOR ALL
  USING (id = public.current_user_id())
  WITH CHECK (id = public.current_user_id());

-- Per-user resources: owner can do everything.
CREATE POLICY accounts_owner_rw ON public.accounts
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

CREATE POLICY transactions_owner_rw ON public.transactions
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

CREATE POLICY budgets_owner_rw ON public.budgets
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

CREATE POLICY goals_owner_rw ON public.goals
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

-- Family groups: owner can manage; members are visible via family_members policy.
CREATE POLICY family_groups_owner ON public.family_groups
  FOR ALL USING (owner_user_id = public.current_user_id())
         WITH CHECK (owner_user_id = public.current_user_id());

-- Family members: a row is visible/manageable to the family owner OR the member.
CREATE POLICY family_members_self ON public.family_members
  FOR ALL
  USING (
    user_id = public.current_user_id()
    OR family_id IN (
      SELECT id FROM public.family_groups
      WHERE owner_user_id = public.current_user_id()
    )
  )
  WITH CHECK (
    user_id = public.current_user_id()
    OR family_id IN (
      SELECT id FROM public.family_groups
      WHERE owner_user_id = public.current_user_id()
    )
  );

-- Consent ledger: subject (the person being acted upon) can read; only the
-- backend service role can write (handled by bypassing RLS via service key).
CREATE POLICY consent_events_self ON public.consent_events
  FOR SELECT USING (subject_user_id = public.current_user_id());

-- Notifications: owner only.
CREATE POLICY notifications_owner ON public.notifications
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

-- Devices: owner only.
CREATE POLICY devices_owner ON public.devices
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

-- ---------- 5. Service-role grants ----------------------------------
-- Supabase grants `service_role` BYPASS RLS by default. The NestJS backend
-- connects with the service-role key for cross-user operations (notifications
-- fanout, family invite acceptance) and sets `app.user_id` per request to
-- enforce correct ownership at the RLS layer for the rest of the calls.
-- Nothing extra to do here — this comment is a reminder.

-- ---------- 6. Done ---------------------------------------------------
SELECT 'Felo schema initialized' AS status;
