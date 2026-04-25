-- 007_budget_baselines.sql
--
-- CTO sign-off blocker (stage-7-e2-to-e8 review):
-- Move budget anchors from Flutter source into DB — product team owns
-- these numbers, not engineering. Phase 5.1 budget screen now reads
-- the suggested monthly budget total per currency from journey-config
-- instead of a hardcoded const map.
--
-- D-019 (budget templates by region+earning_type) provides percentages;
-- this table provides the absolute baseline a percentage is multiplied
-- against. Together they fully drive the pre-fill numbers shown on
-- 11-Set-your-budget.

CREATE TABLE IF NOT EXISTS public.budget_baselines (
  currency_iso CHAR(3) PRIMARY KEY,
  -- Major-unit anchor (e.g., 100000 = Rs 100,000 / mo for PKR).
  -- Stored as major units for product readability; Flutter multiplies
  -- by 100 for minor-unit math.
  baseline_major INT NOT NULL CHECK (baseline_major > 0),
  -- Provenance — how this number was set, so product can review.
  source_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.budget_baselines (currency_iso, baseline_major, source_note) VALUES
  ('PKR', 100000, 'PK salaried median monthly take-home, Pakistan Bureau of Statistics 2024'),
  ('INR',  30000, 'IN entry/mid salaried monthly net, RBI household finance survey 2024'),
  ('BDT',  30000, 'BD salaried median monthly net'),
  ('NPR',  30000, 'NP salaried median monthly net'),
  ('LKR',  50000, 'LK salaried median monthly net'),
  ('CAD',   5000, 'CA diaspora salaried median monthly net'),
  ('USD',   5000, 'US diaspora salaried median monthly net'),
  ('GBP',   4000, 'GB diaspora salaried median monthly net'),
  ('AED',   8000, 'AE diaspora salaried median monthly net'),
  ('SAR',  10000, 'SA diaspora salaried median monthly net')
ON CONFLICT (currency_iso) DO UPDATE SET
  baseline_major = EXCLUDED.baseline_major,
  source_note    = EXCLUDED.source_note,
  updated_at     = NOW();

-- Reference data: public read, service-role write
ALTER TABLE public.budget_baselines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ref_public_read ON public.budget_baselines;
CREATE POLICY ref_public_read ON public.budget_baselines FOR SELECT USING (TRUE);

-- Bump journey_config version so caches invalidate.
UPDATE public.journey_config_versions
   SET current_version = '2026-04-26-2'
 WHERE id = 1;

COMMENT ON TABLE public.budget_baselines IS
  'D-019 absolute baseline anchors per currency. Owned by product team. Engineering does NOT author these values.';
