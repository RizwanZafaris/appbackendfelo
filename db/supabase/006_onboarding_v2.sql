-- 006_onboarding_v2.sql
--
-- Onboarding v2 — full schema applied per Stage 4 system design
-- (`docs/04-system-design/system-design.md` in appuifelo).
--
-- All additive: new tables only, no rewrites of existing tables (extends
-- `goals` + `budget_categories` with new optional columns only).
-- Idempotent via IF NOT EXISTS / ON CONFLICT.

-- =========================================================================
-- 3.1 Reference tables (DB-driven content per D-029)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.regions (
  iso2          CHAR(2) PRIMARY KEY,
  name          TEXT NOT NULL,
  currency_iso  CHAR(3) NOT NULL,
  dial_code     TEXT NOT NULL,
  default_locale TEXT NOT NULL DEFAULT 'en',
  display_order INT NOT NULL DEFAULT 100,
  is_primary_market BOOLEAN NOT NULL DEFAULT FALSE,
  is_diaspora_corridor BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO public.regions (iso2, name, currency_iso, dial_code, display_order, is_primary_market, is_diaspora_corridor) VALUES
  ('PK', 'Pakistan',     'PKR', '+92',  10,  TRUE,  FALSE),
  ('IN', 'India',        'INR', '+91',  20,  TRUE,  FALSE),
  ('BD', 'Bangladesh',   'BDT', '+880', 30,  TRUE,  FALSE),
  ('NP', 'Nepal',        'NPR', '+977', 40,  TRUE,  FALSE),
  ('LK', 'Sri Lanka',    'LKR', '+94',  50,  TRUE,  FALSE),
  ('CA', 'Canada',       'CAD', '+1',   60,  FALSE, TRUE),
  ('GB', 'United Kingdom','GBP', '+44',  70,  FALSE, TRUE),
  ('US', 'United States','USD', '+1',   80,  FALSE, TRUE),
  ('AE', 'UAE',          'AED', '+971', 90,  FALSE, TRUE),
  ('SA', 'Saudi Arabia', 'SAR', '+966', 100, FALSE, TRUE)
  ON CONFLICT (iso2) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.banks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_iso2 CHAR(2) NOT NULL REFERENCES public.regions(iso2),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  logo_url    TEXT,
  display_order INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (region_iso2, slug)
);
CREATE INDEX IF NOT EXISTS idx_banks_region ON public.banks(region_iso2) WHERE is_active;

INSERT INTO public.banks (region_iso2, slug, name, display_order) VALUES
  -- Pakistan
  ('PK', 'hbl', 'HBL', 10),
  ('PK', 'meezan', 'Meezan Bank', 20),
  ('PK', 'ubl', 'UBL', 30),
  ('PK', 'mcb', 'MCB', 40),
  ('PK', 'allied', 'Allied Bank', 50),
  ('PK', 'faysal', 'Faysal Bank', 60),
  ('PK', 'bank_alfalah', 'Bank Alfalah', 70),
  ('PK', 'standard_chartered', 'Standard Chartered', 80),
  ('PK', 'bank_al_habib', 'Bank Al Habib', 90),
  ('PK', 'askari', 'Askari Bank', 100),
  ('PK', 'nbp', 'NBP', 110),
  ('PK', 'habib_metro', 'Habib Metro', 120),
  ('PK', 'soneri', 'Soneri Bank', 130),
  ('PK', 'silk_bank', 'Silk Bank', 140),
  -- India
  ('IN', 'hdfc', 'HDFC Bank', 10),
  ('IN', 'icici', 'ICICI Bank', 20),
  ('IN', 'sbi', 'State Bank of India', 30),
  ('IN', 'axis', 'Axis Bank', 40),
  ('IN', 'kotak', 'Kotak Mahindra', 50),
  ('IN', 'pnb', 'Punjab National Bank', 60),
  ('IN', 'bob', 'Bank of Baroda', 70),
  ('IN', 'canara', 'Canara Bank', 80),
  ('IN', 'idfc', 'IDFC First', 90),
  -- UAE
  ('AE', 'enbd', 'Emirates NBD', 10),
  ('AE', 'adcb', 'Abu Dhabi Commercial Bank', 20),
  ('AE', 'fab', 'First Abu Dhabi Bank', 30),
  ('AE', 'mashreq', 'Mashreq Bank', 40),
  ('AE', 'wio', 'Wio Bank', 50),
  ('AE', 'adib', 'Abu Dhabi Islamic Bank', 60),
  ('AE', 'dib', 'Dubai Islamic Bank', 70),
  ('AE', 'rak_bank', 'RAK Bank', 80),
  -- Canada
  ('CA', 'td', 'TD Canada Trust', 10),
  ('CA', 'rbc', 'RBC', 20),
  ('CA', 'scotiabank', 'Scotiabank', 30),
  ('CA', 'bmo', 'BMO', 40),
  ('CA', 'cibc', 'CIBC', 50),
  ('CA', 'wealthsimple', 'Wealthsimple', 60),
  -- Bangladesh
  ('BD', 'dutch_bangla', 'Dutch-Bangla Bank', 10),
  ('BD', 'brac', 'BRAC Bank', 20),
  ('BD', 'ebl', 'Eastern Bank', 30),
  ('BD', 'city_bank', 'The City Bank', 40)
  ON CONFLICT (region_iso2, slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_iso2 CHAR(2) NOT NULL REFERENCES public.regions(iso2),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  logo_url    TEXT,
  is_international BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (region_iso2, slug)
);

INSERT INTO public.wallets (region_iso2, slug, name, is_international, display_order) VALUES
  -- Pakistan
  ('PK', 'jazzcash', 'JazzCash', FALSE, 10),
  ('PK', 'easypaisa', 'Easypaisa', FALSE, 20),
  ('PK', 'sadapay', 'SadaPay', FALSE, 30),
  ('PK', 'nayapay', 'NayaPay', FALSE, 40),
  ('PK', 'zindigi', 'Zindigi', FALSE, 50),
  ('PK', 'wise', 'Wise', TRUE, 60),
  ('PK', 'payoneer', 'Payoneer', TRUE, 70),
  ('PK', 'paypal', 'PayPal', TRUE, 80),
  -- India
  ('IN', 'paytm', 'Paytm', FALSE, 10),
  ('IN', 'phonepe', 'PhonePe', FALSE, 20),
  ('IN', 'gpay', 'Google Pay', FALSE, 30),
  ('IN', 'amazon_pay', 'Amazon Pay', FALSE, 40),
  -- UAE
  ('AE', 'careem_pay', 'Careem Pay', FALSE, 10),
  ('AE', 'e_money', 'e&money', FALSE, 20),
  -- Bangladesh
  ('BD', 'bkash', 'bKash', FALSE, 10),
  ('BD', 'nagad', 'Nagad', FALSE, 20),
  ('BD', 'rocket', 'Rocket', FALSE, 30)
  ON CONFLICT (region_iso2, slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.earning_types_master (
  slug TEXT PRIMARY KEY,
  display_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.earning_types_master (slug, display_order) VALUES
  ('salaried', 10), ('freelancer', 20), ('business_owner', 30),
  ('investor', 40), ('finance_professional', 50), ('student', 60),
  ('homemaker', 70), ('other', 80) ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.investment_types_master (
  slug TEXT PRIMARY KEY,
  display_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.investment_types_master (slug, display_order) VALUES
  ('stocks', 10), ('mutual_funds', 20), ('crypto', 30),
  ('gold', 40), ('real_estate', 50), ('bonds_sukuk', 60),
  ('other', 70) ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.family_remittance_options (
  slug TEXT PRIMARY KEY,
  display_order INT NOT NULL DEFAULT 100,
  triggers_step2 BOOLEAN NOT NULL,
  is_mutually_exclusive BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO public.family_remittance_options (slug, display_order, triggers_step2, is_mutually_exclusive) VALUES
  ('send_regularly', 10, TRUE, FALSE),
  ('receive_abroad', 20, TRUE, FALSE),
  ('support_financially', 30, FALSE, FALSE),
  ('manage_household', 40, FALSE, FALSE),
  ('none', 99, FALSE, TRUE) ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.goal_templates (
  slug TEXT PRIMARY KEY,
  default_label TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 100,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.goal_templates (slug, default_label, icon_key, display_order, is_custom) VALUES
  ('home', 'Buy a home', 'home', 10, FALSE),
  ('vehicle', 'Buy a vehicle', 'car', 20, FALSE),
  ('education_fund', 'Education fund', 'graduation_cap', 30, FALSE),
  ('travel', 'Travel', 'plane', 40, FALSE),
  ('wedding', 'Wedding', 'rings', 50, FALSE),
  ('family_planning', 'Family planning', 'family', 60, FALSE),
  ('retirement', 'Retirement', 'sun', 70, FALSE),
  ('build_wealth', 'Build wealth', 'trending_up', 80, FALSE),
  ('emergency_fund', 'Emergency fund', 'shield', 90, FALSE),
  ('hajj_umrah', 'Hajj/Umrah', 'kaaba', 100, FALSE),
  ('custom', 'Custom', 'pencil', 999, TRUE) ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.budget_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_iso2 CHAR(2) NOT NULL REFERENCES public.regions(iso2),
  earning_type TEXT NOT NULL REFERENCES public.earning_types_master(slug),
  category_slug TEXT NOT NULL,
  default_pct INT NOT NULL CHECK (default_pct BETWEEN 0 AND 100),
  default_currency CHAR(3) NOT NULL,
  display_order INT NOT NULL DEFAULT 100,
  semantic TEXT NOT NULL CHECK (semantic IN ('inflow', 'outflow')),
  UNIQUE (region_iso2, earning_type, category_slug)
);

-- PK Salaried template (D-019)
INSERT INTO public.budget_templates (region_iso2, earning_type, category_slug, default_pct, default_currency, display_order, semantic) VALUES
  ('PK', 'salaried', 'food',           17, 'PKR', 10, 'outflow'),
  ('PK', 'salaried', 'transport',       8, 'PKR', 20, 'outflow'),
  ('PK', 'salaried', 'rent',           25, 'PKR', 30, 'outflow'),
  ('PK', 'salaried', 'family_support', 18, 'PKR', 40, 'outflow'),
  ('PK', 'salaried', 'shopping',       10, 'PKR', 50, 'outflow'),
  ('PK', 'salaried', 'health',          5, 'PKR', 60, 'outflow'),
  ('PK', 'salaried', 'savings',        17, 'PKR', 70, 'outflow'),
  -- PK Freelancer
  ('PK', 'freelancer', 'food',         13, 'PKR', 10, 'outflow'),
  ('PK', 'freelancer', 'transport',     5, 'PKR', 20, 'outflow'),
  ('PK', 'freelancer', 'rent',         25, 'PKR', 30, 'outflow'),
  ('PK', 'freelancer', 'family_support',15, 'PKR', 40, 'outflow'),
  ('PK', 'freelancer', 'shopping',      8, 'PKR', 50, 'outflow'),
  ('PK', 'freelancer', 'buffer',       12, 'PKR', 60, 'outflow'),
  ('PK', 'freelancer', 'savings',      22, 'PKR', 70, 'outflow'),
  -- PK Student (D-020 — family_allowance is INFLOW)
  ('PK', 'student', 'food',            28, 'PKR', 10, 'outflow'),
  ('PK', 'student', 'transport',        8, 'PKR', 20, 'outflow'),
  ('PK', 'student', 'education',       10, 'PKR', 30, 'outflow'),
  ('PK', 'student', 'entertainment',   16, 'PKR', 40, 'outflow'),
  ('PK', 'student', 'shopping',        16, 'PKR', 50, 'outflow'),
  ('PK', 'student', 'family_allowance', 12, 'PKR', 60, 'inflow'),
  ('PK', 'student', 'savings',         10, 'PKR', 70, 'outflow'),
  -- PK Business owner
  ('PK', 'business_owner', 'food',           10, 'PKR', 10, 'outflow'),
  ('PK', 'business_owner', 'transport',       7, 'PKR', 20, 'outflow'),
  ('PK', 'business_owner', 'rent',           18, 'PKR', 30, 'outflow'),
  ('PK', 'business_owner', 'family_support', 32, 'PKR', 40, 'outflow'),
  ('PK', 'business_owner', 'education',      22, 'PKR', 50, 'outflow'),
  ('PK', 'business_owner', 'health',          4, 'PKR', 60, 'outflow'),
  ('PK', 'business_owner', 'savings',         7, 'PKR', 70, 'outflow'),
  -- CA Salaried
  ('CA', 'salaried', 'food',           18, 'CAD', 10, 'outflow'),
  ('CA', 'salaried', 'transport',       5, 'CAD', 20, 'outflow'),
  ('CA', 'salaried', 'rent_mortgage',  38, 'CAD', 30, 'outflow'),
  ('CA', 'salaried', 'family_support', 14, 'CAD', 40, 'outflow'),
  ('CA', 'salaried', 'daycare',        18, 'CAD', 50, 'outflow'),
  ('CA', 'salaried', 'savings',         7, 'CAD', 70, 'outflow'),
  -- BD Student
  ('BD', 'student', 'food',            30, 'BDT', 10, 'outflow'),
  ('BD', 'student', 'transport',        8, 'BDT', 20, 'outflow'),
  ('BD', 'student', 'education',       11, 'BDT', 30, 'outflow'),
  ('BD', 'student', 'entertainment',   17, 'BDT', 40, 'outflow'),
  ('BD', 'student', 'shopping',        14, 'BDT', 50, 'outflow'),
  ('BD', 'student', 'family_allowance', 14, 'BDT', 60, 'inflow'),
  ('BD', 'student', 'savings',          6, 'BDT', 70, 'outflow')
  ON CONFLICT (region_iso2, earning_type, category_slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.permission_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title_key TEXT NOT NULL,
  body_key TEXT NOT NULL,
  visible_on_platforms TEXT[] NOT NULL DEFAULT ARRAY['ios','android'],
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 100
);
INSERT INTO public.permission_cards (slug, title_key, body_key, visible_on_platforms, is_optional, display_order) VALUES
  ('sms',           'perm.sms.title',     'perm.sms.body',     ARRAY['android'],         FALSE, 10),
  ('notifications', 'perm.notif.title',   'perm.notif.body',   ARRAY['ios','android'],   FALSE, 20),
  ('location',      'perm.loc.title',     'perm.loc.body',     ARRAY['ios','android'],   TRUE,  30),
  ('contacts',      'perm.contacts.title','perm.contacts.body',ARRAY['ios','android'],   TRUE,  40)
  ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.phase7_status_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  template_string_key TEXT NOT NULL,
  display_order INT NOT NULL,
  trigger_condition TEXT NOT NULL  -- expression evaluated client-side against OnboardingState
);
INSERT INTO public.phase7_status_templates (template_key, template_string_key, display_order, trigger_condition) VALUES
  ('account_setup',    'phase7.account_setup',    10, 'always'),
  ('linking_accounts', 'phase7.linking_accounts', 20, 'accounts.length > 0'),
  ('account_dashboard','phase7.account_dashboard',20, 'accounts_deferred = true'),
  ('budget_building',  'phase7.budget_building',  30, 'always'),
  ('goal_tracking',    'phase7.goal_tracking',    40, 'goals.length = 2'),
  ('corridor',         'phase7.corridor',         50, 'has_corridor = true'),
  ('investments',      'phase7.investments',      60, 'investments.length > 0'),
  ('personalizing',    'phase7.personalizing',    70, 'always')
  ON CONFLICT (template_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.journey_strings (
  key TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  value TEXT NOT NULL,
  PRIMARY KEY (key, locale)
);
INSERT INTO public.journey_strings (key, locale, value) VALUES
  ('welcome.hero',     'en', 'Your money, simply seen.'),
  ('welcome.subtitle', 'en', 'Track every rupee, every wallet, every bank — in one app.'),
  ('welcome.cta',      'en', 'Get started'),
  ('welcome.signin_link','en', 'I already have an account → Sign in'),
  ('signup.with_google',  'en', 'Continue with Google'),
  ('signup.with_apple',   'en', 'Continue with Apple'),
  ('signup.with_facebook','en', 'Continue with Facebook'),
  ('signup.with_email',   'en', 'Continue with Email'),
  ('signup.with_mobile',  'en', 'Continue with Mobile'),
  ('perm.sms.title',  'en', 'Auto-track every transaction'),
  ('perm.sms.body',   'en', 'If your bank sends transaction SMS to this device, FELO will categorize them automatically. You''ll never type a number.'),
  ('perm.notif.title','en', 'Stay on top of your money'),
  ('perm.notif.body', 'en', 'Bill reminders, budget alerts, and goal updates.'),
  ('perm.loc.title',  'en', 'Smart category suggestions'),
  ('perm.loc.body',   'en', 'We can suggest categories based on where you spent (optional).'),
  ('perm.contacts.title','en', 'Send money to family faster'),
  ('perm.contacts.body','en', 'For when you want to split bills or send money — coming soon.'),
  ('phase7.account_setup',     'en', 'Setting up your {primary_currency} account...'),
  ('phase7.linking_accounts',  'en', 'Linking {accounts_csv}...'),
  ('phase7.account_dashboard', 'en', 'Setting up your account dashboard...'),
  ('phase7.budget_building',   'en', 'Building your budget for {currency_symbol}{total}...'),
  ('phase7.goal_tracking',     'en', 'Tracking your {goal_1} and {goal_2}...'),
  ('phase7.corridor',          'en', 'Connecting your {primary_country} → {top_corridor_country} corridor...'),
  ('phase7.investments',       'en', 'Loading your {investment_types_csv}...'),
  ('phase7.personalizing',     'en', 'Personalizing your dashboard, {first_name}...'),
  ('microcopy.earning_type', 'en', 'We use this to suggest budget categories.'),
  ('microcopy.accounts',     'en', 'We use this to organize your dashboard. We don''t access your bank yet.'),
  ('microcopy.budget_total', 'en', 'This stays private and is only used on your dashboard.'),
  ('microcopy.family_remit', 'en', 'This helps us show the right corridor for you.'),
  ('phase5.goals.upsell_seed','en', 'FELO Plus members can set unlimited goals.')
  ON CONFLICT (key, locale) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.journey_config_versions (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.journey_config_versions (id, current_version) VALUES (1, '2026-04-26-1') ON CONFLICT DO NOTHING;

-- =========================================================================
-- 3.2 Per-user state tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  current_phase INT NOT NULL DEFAULT 1,
  current_step TEXT NOT NULL DEFAULT 'welcome',
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  abandoned_at TIMESTAMPTZ,
  abandoned_step TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_user ON public.onboarding_sessions(user_id);

CREATE TABLE IF NOT EXISTS public.onboarding_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.onboarding_sessions(id),
  primary_region CHAR(2) REFERENCES public.regions(iso2),
  secondary_regions TEXT[] NOT NULL DEFAULT '{}',
  name TEXT,
  ip_country CHAR(2),
  accounts_deferred BOOLEAN NOT NULL DEFAULT FALSE,
  invests BOOLEAN,
  last_completed_step TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sms BOOLEAN,
  notifications BOOLEAN,
  location BOOLEAN,
  contacts BOOLEAN,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_earning_types (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL REFERENCES public.earning_types_master(slug),
  custom_value TEXT,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE IF NOT EXISTS public.onb_user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_kind TEXT NOT NULL CHECK (account_kind IN ('bank','wallet')),
  provider_slug TEXT NOT NULL,
  region_iso2 CHAR(2) NOT NULL REFERENCES public.regions(iso2),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_kind, provider_slug, region_iso2)
);

CREATE TABLE IF NOT EXISTS public.user_investments (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investment_type TEXT NOT NULL REFERENCES public.investment_types_master(slug),
  custom_value TEXT,
  PRIMARY KEY (user_id, investment_type)
);

CREATE TABLE IF NOT EXISTS public.remittance_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  options TEXT[] NOT NULL DEFAULT '{}',
  sends_to TEXT[] NOT NULL DEFAULT '{}',
  receives_from TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extensions to existing tables (D-008, D-020)
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS slot SMALLINT CHECK (slot IN (1,2)),
  ADD COLUMN IF NOT EXISTS template_slug TEXT REFERENCES public.goal_templates(slug),
  ADD COLUMN IF NOT EXISTS custom_label TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_slot
  ON public.goals(user_id, slot) WHERE slot IS NOT NULL;

ALTER TABLE public.budget_categories
  ADD COLUMN IF NOT EXISTS semantic TEXT NOT NULL DEFAULT 'outflow'
    CHECK (semantic IN ('inflow','outflow'));

CREATE TABLE IF NOT EXISTS public.phone_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  provider_name TEXT NOT NULL,
  ip_detected_country CHAR(2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_otp_phone_active
  ON public.phone_otp_challenges(phone_e164) WHERE used_at IS NULL;

-- =========================================================================
-- 3.3 Analytics tables (D-030)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id UUID NOT NULL,
  event_name TEXT NOT NULL,
  frd_id TEXT,
  step_id TEXT,
  phase INT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_country CHAR(2),
  user_agent TEXT,
  locale TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON public.events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_session ON public.events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_name ON public.events(event_name, occurred_at);

CREATE TABLE IF NOT EXISTS public.funnel_sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_step_reached TEXT,
  abandoned_at TIMESTAMPTZ,
  abandoned_step TEXT,
  signup_method TEXT,
  primary_region CHAR(2),
  install_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_funnel_user ON public.funnel_sessions(user_id);

-- =========================================================================
-- 3.4 RLS policies
-- =========================================================================

-- Reference tables: public read, no write (service-role bypasses RLS for admin)
ALTER TABLE public.regions                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banks                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earning_types_master      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_types_master   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_remittance_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_cards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase7_status_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_strings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_config_versions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ref_public_read ON public.regions;
CREATE POLICY ref_public_read ON public.regions FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.banks;
CREATE POLICY ref_public_read ON public.banks FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.wallets;
CREATE POLICY ref_public_read ON public.wallets FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.earning_types_master;
CREATE POLICY ref_public_read ON public.earning_types_master FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.investment_types_master;
CREATE POLICY ref_public_read ON public.investment_types_master FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.family_remittance_options;
CREATE POLICY ref_public_read ON public.family_remittance_options FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.goal_templates;
CREATE POLICY ref_public_read ON public.goal_templates FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.budget_templates;
CREATE POLICY ref_public_read ON public.budget_templates FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.permission_cards;
CREATE POLICY ref_public_read ON public.permission_cards FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.phase7_status_templates;
CREATE POLICY ref_public_read ON public.phase7_status_templates FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.journey_strings;
CREATE POLICY ref_public_read ON public.journey_strings FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS ref_public_read ON public.journey_config_versions;
CREATE POLICY ref_public_read ON public.journey_config_versions FOR SELECT USING (TRUE);

-- Per-user tables: scoped to auth.uid()
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.onboarding_sessions;
CREATE POLICY user_owned ON public.onboarding_sessions FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.onboarding_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.onboarding_state;
CREATE POLICY user_owned ON public.onboarding_state FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.permissions;
CREATE POLICY user_owned ON public.permissions FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.user_earning_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.user_earning_types;
CREATE POLICY user_owned ON public.user_earning_types FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.onb_user_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.onb_user_accounts;
CREATE POLICY user_owned ON public.onb_user_accounts FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.user_investments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.user_investments;
CREATE POLICY user_owned ON public.user_investments FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.remittance_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owned ON public.remittance_preferences;
CREATE POLICY user_owned ON public.remittance_preferences FOR ALL USING (user_id = auth.uid());

-- Analytics: insert allowed by self (or anonymous for pre-auth events), select admin-only
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_self_insert ON public.events;
CREATE POLICY events_self_insert ON public.events
  FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

ALTER TABLE public.funnel_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funnel_self ON public.funnel_sessions;
CREATE POLICY funnel_self ON public.funnel_sessions
  FOR ALL USING (user_id = auth.uid() OR user_id IS NULL);

-- phone_otp_challenges: admin/service-role only (sensitive)
ALTER TABLE public.phone_otp_challenges ENABLE ROW LEVEL SECURITY;
-- (no user-facing policy; service-role bypasses RLS)

COMMENT ON TABLE public.events IS 'Multi-sink analytics — internal Postgres source of truth (D-030 sink 1)';
COMMENT ON TABLE public.funnel_sessions IS 'End-to-end onboarding journey tracking (D-030)';
COMMENT ON TABLE public.journey_config_versions IS 'Cache invalidation key for journey_config payload (D-029)';
