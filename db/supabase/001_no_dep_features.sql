-- =====================================================================
-- FELO — Sprints 1-4: tables for the features we can build with zero
-- external dependencies. Idempotent. Apply via Supabase SQL Editor or
-- `npm run db:migrate`.
--
-- Adds:
--   • mfa_secrets       (F010 — real TOTP 2FA, RFC 6238)
--   • referral_codes    (F011 — invite + FELO Plus)
--   • referrals
--   • splits + split_participants (F007 — group payments)
--   • investments       (F008 — manual portfolio)
--   • Extends `devices` with is_trusted
-- =====================================================================

BEGIN;

-- ---------- F010 — 2FA ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.mfa_secrets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  secret          TEXT NOT NULL,           -- base32-encoded TOTP seed
  verified        BOOLEAN NOT NULL DEFAULT false,
  recovery_codes  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 8 single-use codes
  enabled_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mfa_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_secrets_owner ON public.mfa_secrets;
CREATE POLICY mfa_secrets_owner ON public.mfa_secrets
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN NOT NULL DEFAULT false;

-- ---------- F011 — Referrals + FELO Plus ----------------------------
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code        TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_codes_owner ON public.referral_codes;
CREATE POLICY referral_codes_owner ON public.referral_codes
  FOR ALL USING (owner_user_id = public.current_user_id())
         WITH CHECK (owner_user_id = public.current_user_id());

CREATE TABLE IF NOT EXISTS public.referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id         UUID NOT NULL REFERENCES public.referral_codes(id) ON DELETE CASCADE,
  referrer_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','qualified','rewarded','expired','revoked')),
  reward_minor    BIGINT,
  reward_currency CHAR(3),
  qualified_at    TIMESTAMPTZ,
  rewarded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referred_user_id)
);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referrals_referrer_or_referred ON public.referrals;
CREATE POLICY referrals_referrer_or_referred ON public.referrals
  FOR ALL USING (
    referrer_user_id = public.current_user_id()
    OR referred_user_id = public.current_user_id()
  )
  WITH CHECK (
    referrer_user_id = public.current_user_id()
    OR referred_user_id = public.current_user_id()
  );

-- ---------- F007 — Splits -------------------------------------------
CREATE TABLE IF NOT EXISTS public.splits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  currency     CHAR(3) NOT NULL,
  total_minor  BIGINT NOT NULL,
  notes        TEXT,
  is_settled   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_splits_owner ON public.splits(owner_user_id);
ALTER TABLE public.splits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS splits_owner ON public.splits;
CREATE POLICY splits_owner ON public.splits
  FOR ALL USING (owner_user_id = public.current_user_id())
         WITH CHECK (owner_user_id = public.current_user_id());

CREATE TABLE IF NOT EXISTS public.split_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id      UUID NOT NULL REFERENCES public.splits(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.profiles(id),  -- nullable: external participants
  display_name  TEXT NOT NULL,
  share_minor   BIGINT NOT NULL,
  paid          BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_split_participants_split ON public.split_participants(split_id);
ALTER TABLE public.split_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS split_participants_owner_or_member ON public.split_participants;
CREATE POLICY split_participants_owner_or_member ON public.split_participants
  FOR ALL USING (
    user_id = public.current_user_id()
    OR split_id IN (SELECT id FROM public.splits WHERE owner_user_id = public.current_user_id())
  )
  WITH CHECK (
    split_id IN (SELECT id FROM public.splits WHERE owner_user_id = public.current_user_id())
  );

-- ---------- F008 — Investments --------------------------------------
CREATE TABLE IF NOT EXISTS public.investments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  symbol            TEXT NOT NULL,
  name              TEXT,
  asset_class       TEXT NOT NULL DEFAULT 'equity'
                    CHECK (asset_class IN ('equity','etf','crypto','mutual_fund','bond','real_estate','other')),
  currency          CHAR(3) NOT NULL,
  units             NUMERIC(20,8) NOT NULL,
  cost_basis_minor  BIGINT NOT NULL,                    -- total cost in minor units
  last_price_minor  BIGINT,                              -- last known price per unit
  last_priced_at    TIMESTAMPTZ,
  notes             TEXT,
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investments_user ON public.investments(user_id);
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS investments_owner ON public.investments;
CREATE POLICY investments_owner ON public.investments
  FOR ALL USING (user_id = public.current_user_id())
         WITH CHECK (user_id = public.current_user_id());

-- updated_at trigger for investments (other tables already have it)
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.investments;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.investments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

SELECT 'Felo no-dep features schema applied' AS status;
