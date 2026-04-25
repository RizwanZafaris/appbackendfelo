-- 005_profile_settings.sql
-- Add a flexible JSONB `settings` column to profiles so the Flutter
-- `ProfileSettings` model round-trips losslessly. A JSONB blob (instead
-- of N individual columns) keeps future settings additions cheap and
-- avoids per-add migrations.
--
-- Initial keys (validated client-side via the Flutter ProfileSettings
-- freezed class, not by Postgres):
--   themeMode               : 'system' | 'light' | 'dark'
--   operationalNotifications: boolean
--   marketingConsent        : boolean
--   smsParserEnabled        : boolean
--
-- Defaults reflect the current Flutter defaults so existing rows render
-- the same UX after the migration runs.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS keeps re-runs safe.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT
    '{"themeMode":"system","operationalNotifications":true,"marketingConsent":false,"smsParserEnabled":false}'::jsonb;

COMMENT ON COLUMN public.profiles.settings IS
  'Flutter-driven user settings blob. Schema validated client-side.';
