-- F017 — Sumsub KYC Integration
-- Adds applicant ID tracking for Sumsub KYC verification.
-- Applied: 2026-05-02

-- Track the Sumsub applicant ID on each profile (1:1 mapping).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sumsub_applicant_id TEXT UNIQUE;

-- Index for fast webhook resolution (applicant ID → user lookup).
CREATE INDEX IF NOT EXISTS idx_profiles_sumsub_applicant
  ON profiles(sumsub_applicant_id)
  WHERE sumsub_applicant_id IS NOT NULL;