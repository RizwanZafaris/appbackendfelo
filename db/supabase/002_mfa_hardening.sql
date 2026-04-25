-- =====================================================================
-- FELO — Sprint 1 fix-up: MFA hardening
--   • last_used_step  prevents TOTP replay (RFC 6238 §5.2)
--   • secret + recovery_codes are now app-encrypted/hashed (TEXT shape
--     unchanged — values become base64(IV+TAG+ciphertext) and bcrypt-style
--     hashes respectively)
-- Idempotent.
-- =====================================================================

BEGIN;

ALTER TABLE public.mfa_secrets
  ADD COLUMN IF NOT EXISTS last_used_step BIGINT;

COMMIT;

SELECT 'mfa_hardening applied' AS status;
