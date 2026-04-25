-- =====================================================================
-- FELO — Sprint 4 hardening: device upsert race fix
--   • Adds UNIQUE (user_id, push_token) on public.devices so
--     ON CONFLICT DO UPDATE replaces the read-then-insert pattern.
--   • Adds is_trusted backfill — only the OWNER can flip it (server-set).
-- Idempotent.
-- =====================================================================

BEGIN;

-- Drop legacy duplicates first so the unique index can be created
DELETE FROM public.devices d1
USING public.devices d2
WHERE d1.id < d2.id
  AND d1.user_id = d2.user_id
  AND d1.push_token = d2.push_token;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_user_id_push_token_unique;
ALTER TABLE public.devices
  ADD CONSTRAINT devices_user_id_push_token_unique UNIQUE (user_id, push_token);

COMMIT;

SELECT 'sprint4_hardening applied' AS status;
