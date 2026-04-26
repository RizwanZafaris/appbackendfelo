-- 008_corridor_policy_and_identities.sql
--
-- Senior fintech audit closure (stage-7-e2-to-e8 review §1.3, §4, §5,
-- §12). Adds the missing centralized configs and identity tables so
-- corridor policy, sanctions, and multi-auth-identity logic stop
-- depending on hardcoded constants in client code.
--
-- Touches:
--   1. regions.country_status      — active|coming_soon|not_supported|sanctioned
--   2. country_corridors           — pair-level allow/block (PK→IN, PK→IL)
--   3. user_identities             — N auth methods → 1 user/profile
--   4. otp_attempts                — 3-attempt + 30-min cooldown enforcement
--   5. banks.* metadata            — logo_url, bank_code, integration_type, account_types
--   6. user_bank_accounts          — duplicate-prevention via UNIQUE
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. regions.country_status ─────────────────────────────────────
ALTER TABLE public.regions
  ADD COLUMN IF NOT EXISTS country_status TEXT NOT NULL DEFAULT 'active'
    CHECK (country_status IN ('active', 'coming_soon', 'not_supported', 'sanctioned'));

-- Mark a few high-risk rows as sanctioned/not_supported so they never
-- appear in pickers. Source: OFAC + UK HMT consolidated lists (2026-04).
INSERT INTO public.regions (iso2, name, currency_iso, dial_code, display_order, is_primary_market, is_diaspora_corridor, country_status) VALUES
  ('IL', 'Israel',         'ILS', '+972', 9000, FALSE, FALSE, 'not_supported'),
  ('IR', 'Iran',            'IRR', '+98',  9100, FALSE, FALSE, 'sanctioned'),
  ('KP', 'North Korea',     'KPW', '+850', 9200, FALSE, FALSE, 'sanctioned'),
  ('SY', 'Syria',           'SYP', '+963', 9300, FALSE, FALSE, 'sanctioned'),
  ('CU', 'Cuba',            'CUP', '+53',  9400, FALSE, FALSE, 'sanctioned'),
  ('RU', 'Russia',          'RUB', '+7',   9500, FALSE, FALSE, 'not_supported'),
  ('EG', 'Egypt',           'EGP', '+20',  110,  TRUE,  FALSE, 'active'),
  ('ES', 'Spain',           'EUR', '+34',  120,  FALSE, TRUE,  'active')
ON CONFLICT (iso2) DO UPDATE SET
  country_status = EXCLUDED.country_status,
  is_primary_market = EXCLUDED.is_primary_market,
  is_diaspora_corridor = EXCLUDED.is_diaspora_corridor;

-- ─── 2. country_corridors ──────────────────────────────────────────
-- Pair-level corridor policy. Used to block PK→IN, PK→IL etc. even
-- when both endpoints are otherwise active markets.
CREATE TABLE IF NOT EXISTS public.country_corridors (
  from_iso2     CHAR(2) NOT NULL REFERENCES public.regions(iso2),
  to_iso2       CHAR(2) NOT NULL REFERENCES public.regions(iso2),
  status        TEXT NOT NULL CHECK (
                  status IN ('allowed', 'blocked', 'coming_soon', 'sanctioned')),
  reason        TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_iso2, to_iso2)
);

INSERT INTO public.country_corridors (from_iso2, to_iso2, status, reason) VALUES
  -- PK explicit blocks per audit §4
  ('PK', 'IN', 'blocked',    'Bilateral remittance corridor not supported (regulatory)'),
  ('PK', 'IL', 'blocked',    'Diplomatic restriction'),
  ('PK', 'IR', 'sanctioned', 'OFAC sanctions'),
  -- Mirror blocks
  ('IN', 'PK', 'blocked',    'Bilateral remittance corridor not supported (regulatory)'),
  ('IL', 'PK', 'blocked',    'Diplomatic restriction'),
  -- Sanctions network
  ('PK', 'KP', 'sanctioned', 'OFAC sanctions'),
  ('PK', 'SY', 'sanctioned', 'OFAC sanctions'),
  ('PK', 'CU', 'sanctioned', 'OFAC sanctions')
ON CONFLICT (from_iso2, to_iso2) DO UPDATE SET
  status     = EXCLUDED.status,
  reason     = EXCLUDED.reason,
  updated_at = NOW();

ALTER TABLE public.country_corridors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ref_public_read ON public.country_corridors;
CREATE POLICY ref_public_read ON public.country_corridors FOR SELECT USING (TRUE);

-- ─── 3. user_identities ────────────────────────────────────────────
-- Lets one user.id own N auth methods (email + phone + Google + Apple)
-- so the same human never gets two profiles. The auth.users table
-- in Supabase already enforces 1 row per (provider, identity_value)
-- but we mirror that here so we can JOIN cleanly from product tables.
CREATE TABLE IF NOT EXISTS public.user_identities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (
                  provider IN ('email', 'phone', 'google', 'apple', 'facebook')),
  identity_value TEXT NOT NULL,    -- email lowercased, phone E.164, OAuth sub
  verified_at   TIMESTAMPTZ,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, identity_value)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON public.user_identities(user_id);

-- Only one primary per user
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_identities_primary
  ON public.user_identities(user_id) WHERE is_primary;

ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.user_identities;
CREATE POLICY user_owned ON public.user_identities FOR ALL
  USING (user_id = auth.uid());

-- ─── 4. otp_attempts (3-attempt + 30-min cooldown) ─────────────────
-- The existing `phone_otp_challenges` table tracks individual codes.
-- This sibling table tracks per-identity rate-limit state.
CREATE TABLE IF NOT EXISTS public.otp_attempts (
  identity      TEXT PRIMARY KEY,  -- phone_e164 OR lowercased email
  channel       TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  fail_count    INT NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
  cooldown_until TIMESTAMPTZ,      -- NULL = no cooldown
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_attempts_cooldown
  ON public.otp_attempts(cooldown_until)
  WHERE cooldown_until IS NOT NULL;

-- Service-role only — sensitive
ALTER TABLE public.otp_attempts ENABLE ROW LEVEL SECURITY;

-- ─── 5. banks metadata expansion ───────────────────────────────────
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS bank_code        TEXT,
  ADD COLUMN IF NOT EXISTS account_types    TEXT[] NOT NULL DEFAULT ARRAY['savings','current']::TEXT[],
  ADD COLUMN IF NOT EXISTS integration_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (integration_type IN ('api', 'aggregator', 'manual', 'coming_soon'));

-- Seed a few bank codes + integration types (sample; product fills the rest).
UPDATE public.banks SET bank_code = 'HABBPKKA',  integration_type = 'aggregator' WHERE region_iso2 = 'PK' AND slug = 'hbl';
UPDATE public.banks SET bank_code = 'MEZNPKKA',  integration_type = 'aggregator' WHERE region_iso2 = 'PK' AND slug = 'meezan';
UPDATE public.banks SET bank_code = 'UNILPKKA',  integration_type = 'aggregator' WHERE region_iso2 = 'PK' AND slug = 'ubl';
UPDATE public.banks SET bank_code = 'HDFCINBB',  integration_type = 'api'        WHERE region_iso2 = 'IN' AND slug = 'hdfc';
UPDATE public.banks SET bank_code = 'ICICINBB',  integration_type = 'api'        WHERE region_iso2 = 'IN' AND slug = 'icici';
UPDATE public.banks SET bank_code = 'EBILAEAD',  integration_type = 'api'        WHERE region_iso2 = 'AE' AND slug = 'enbd';
UPDATE public.banks SET bank_code = 'TDOMCATTTOR', integration_type = 'aggregator' WHERE region_iso2 = 'CA' AND slug = 'td';

-- ─── 6. user_bank_accounts (duplicate prevention) ──────────────────
-- The existing `onb_user_accounts` table is the onboarding-time
-- selection surface; this is the canonical post-onboarding record.
CREATE TABLE IF NOT EXISTS public.user_bank_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_id      UUID NOT NULL REFERENCES public.banks(id),
  account_last4 TEXT,                -- masked tail for dedupe display
  account_type TEXT,
  nickname     TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL DEFAULT 'pending_link'
    CHECK (status IN ('pending_link', 'active', 'inactive', 'errored')),
  linked_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Audit §5: prevent the same bank account from being linked twice.
  UNIQUE (user_id, bank_id, account_last4)
);
CREATE INDEX IF NOT EXISTS idx_user_bank_accounts_user
  ON public.user_bank_accounts(user_id);

ALTER TABLE public.user_bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.user_bank_accounts;
CREATE POLICY user_owned ON public.user_bank_accounts FOR ALL
  USING (user_id = auth.uid());

-- ─── Bump cache version so clients re-fetch journey-config ─────────
UPDATE public.journey_config_versions
   SET current_version = '2026-04-26-3'
 WHERE id = 1;

COMMENT ON TABLE public.country_corridors IS
  'Pair-level corridor policy (D-024 + sanctions). Owned by compliance.';
COMMENT ON TABLE public.user_identities IS
  'Multi-auth-method binding to single user. Audit §1 dedup invariant.';
COMMENT ON TABLE public.otp_attempts IS
  'OTP rate-limit state per identity (3 fails → 30min cooldown). Audit §2.';
COMMENT ON TABLE public.user_bank_accounts IS
  'Canonical user→bank link. UNIQUE prevents duplicate binding (Audit §5).';
