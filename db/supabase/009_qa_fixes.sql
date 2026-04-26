-- 009_qa_fixes.sql
--
-- QA pre-release pass closure (post-merge to main).
--
-- Bug 4: `otp_attempts` PK was `identity` alone, which meant the same
-- string used as both email and phone channel would collide on the
-- ON CONFLICT clause. Widen PK to (identity, channel).
--
-- Bug 7: `secondary_regions` text[] interpolation was passing JS arrays
-- through Drizzle ${...} expansion which serializes as JSON-text not
-- as a Postgres text[] literal. Fix is in application code, but we
-- add a defensive cast so even legacy clients passing JSON-stringified
-- arrays don't break the column type.

-- ─── Bug 4: widen otp_attempts PK ──────────────────────────────────
ALTER TABLE public.otp_attempts
  DROP CONSTRAINT IF EXISTS otp_attempts_pkey;

ALTER TABLE public.otp_attempts
  ADD CONSTRAINT otp_attempts_pkey PRIMARY KEY (identity, channel);

-- Drop the old narrow cooldown index since the new PK covers lookups.
DROP INDEX IF EXISTS idx_otp_attempts_cooldown;
CREATE INDEX IF NOT EXISTS idx_otp_attempts_cooldown
  ON public.otp_attempts(cooldown_until)
  WHERE cooldown_until IS NOT NULL;

-- ─── Bug 7: defensive guard on profiles.secondary_regions ──────────
-- The column already exists as TEXT[]; nothing to alter at the schema
-- level. Application-level fix uses Drizzle's `sql.raw` with proper
-- ARRAY[]::text[] literal — see complete.service.ts.

-- Bump cache version
UPDATE public.journey_config_versions
   SET current_version = '2026-04-26-4'
 WHERE id = 1;

COMMENT ON TABLE public.otp_attempts IS
  'OTP rate-limit state. PK widened to (identity, channel) per QA Bug 4.';
