-- 013_soft_launch.sql
--
-- Soft-launch v1 ops surface: launch_readiness_items table backing the
-- ops-portal /launch-readiness checklist UI.
--
-- Idempotent: every statement is `IF NOT EXISTS` / `IF EXISTS`.

BEGIN;

CREATE TABLE IF NOT EXISTS launch_readiness_items (
  id           bigserial PRIMARY KEY,
  key          varchar(128) NOT NULL,
  category     varchar(64)  NOT NULL,
  title        varchar(255) NOT NULL,
  description  text,
  owner        varchar(64),
  status       varchar(32)  NOT NULL DEFAULT 'pending', -- pending | in_progress | done | blocked
  blocking     boolean      NOT NULL DEFAULT true,
  rotation_due_at timestamptz,
  rotation_period_days integer,
  checked_by   uuid,
  checked_at   timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT launch_readiness_items_key_uidx UNIQUE (key)
);

CREATE INDEX IF NOT EXISTS launch_readiness_items_status_idx
  ON launch_readiness_items(status);
CREATE INDEX IF NOT EXISTS launch_readiness_items_category_idx
  ON launch_readiness_items(category);
CREATE INDEX IF NOT EXISTS launch_readiness_items_blocking_idx
  ON launch_readiness_items(blocking) WHERE blocking = true;

-- RLS: only admins read/write. Application-level RolesGuard is the primary
-- gate; this is belt-and-suspenders.
ALTER TABLE launch_readiness_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE launch_readiness_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'launch_readiness_items'
       AND policyname = 'lri_service_role_only'
  ) THEN
    CREATE POLICY lri_service_role_only ON launch_readiness_items
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END$$;

-- Audit log row per state change. The audit_log table comes from 000_init.sql.
CREATE OR REPLACE FUNCTION launch_readiness_items_audit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Only log meaningful state changes, not bulk timestamp bumps.
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_log(actor_user_id, action, target_type, target_id, payload)
    VALUES (
      NEW.checked_by,
      'launch_readiness.status_changed',
      'launch_readiness_item',
      NEW.id::text,
      jsonb_build_object(
        'key', NEW.key,
        'from', OLD.status,
        'to', NEW.status,
        'notes', NEW.notes
      )
    );
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS launch_readiness_items_audit_trg ON launch_readiness_items;
CREATE TRIGGER launch_readiness_items_audit_trg
  BEFORE UPDATE ON launch_readiness_items
  FOR EACH ROW EXECUTE FUNCTION launch_readiness_items_audit();

COMMIT;

-- Seed the canonical OPS_CONFIG checklist. Idempotent on `key`.
INSERT INTO launch_readiness_items(key, category, title, description, owner, blocking, rotation_period_days)
VALUES
  -- Database
  ('supabase.project',          'database',     'Supabase project provisioned (port 5432)', 'Region matches Railway region; session pool used', 'platform', true,  null),
  ('supabase.service_role_key', 'database',     'SUPABASE_SECRET_KEY in Railway',           'Service-role key, write-once; never to mobile/web',  'platform', true,  90),
  ('supabase.anon_key',         'database',     'SUPABASE_PUBLISHABLE_KEY in Railway',      'Anon key safe to mirror to mobile dart-defines',     'platform', true,  null),
  ('supabase.jwks_url',         'database',     'SUPABASE_JWKS_URL set',                    'Backend verifies JWT signatures via JWKS',           'platform', true,  null),
  ('supabase.migrations_applied', 'database',  'All migrations applied 000..013',           'See db/supabase/00_full_init.sql', 'platform', true,  null),
  -- Backend
  ('backend.sentry_dsn',        'observability', 'SENTRY_DSN in Railway',                    'Backend errors → Sentry',                            'observability', true, null),
  ('backend.cipher_key',        'security',     'SECRET_CIPHER_KEY (or KMS_KEY_ARN) set',   'PII column-level encryption key',                    'security', true, 180),
  ('backend.cors_origins',      'security',     'CORS_ORIGINS allowlist set',               'No wildcard; ops portal + mobile origins only',      'platform', true, null),
  ('backend.trust_proxy',       'security',     'TRUST_PROXY_CIDRS set to Railway CIDR',    'IP-based throttling correct',                        'platform', false, null),
  ('backend.launch_ready',      'launch',       'FELO_LAUNCH_READY=1 in Railway',           'Master gate; flip ONLY after every other row done',  'platform', true, null),
  -- Mobile
  ('mobile.api_url',            'mobile',       'FELO_API_URL injected via dart-define',    'https-only; no emulator IP in release',              'mobile', true, null),
  ('mobile.android_keystore',   'mobile',       'Android upload keystore in CI secrets',    'key.properties + keystore in GH Actions secrets',    'mobile', true, null),
  ('mobile.ios_certs',          'mobile',       'iOS distribution cert + provisioning profile', 'Fastlane match preferred',                       'mobile', true, null),
  ('mobile.firebase_android',   'mobile',       'google-services.json (prod flavor)',       'Crashlytics, FCM',                                   'mobile', true, null),
  ('mobile.firebase_ios',       'mobile',       'GoogleService-Info.plist (prod flavor)',   'Crashlytics',                                        'mobile', true, null),
  ('mobile.cert_pin',           'mobile',       'Production TLS SPKI hash baked into Dio',  'Two pins (leaf + backup root)',                      'mobile', true, null),
  -- Ops portal
  ('portal.api_base',           'ops_portal',   'NEXT_PUBLIC_ADMIN_API_BASE set in Vercel', 'Points at production backend URL',                   'platform', true, null),
  ('portal.webauthn_rp_id',     'ops_portal',   'WEBAUTHN_RP_ID matches portal domain',     'WebAuthn credentials are bound to RP ID',            'platform', true, null),
  -- Coach LLM
  ('coach.provider_key',        'coach',        'LLM provider API key set',                 'ANTHROPIC_API_KEY / OPENAI_API_KEY / etc.',           'intelligence', true, 365),
  ('coach.daily_cap',           'coach',        'COACH_DAILY_USD_CAP set',                  'Default $0.25/user/day; deny on overflow',           'intelligence', true, null),
  -- Domains / legal
  ('domain.production',         'domain',       'Production domain attached + TLS A+',      'HSTS preload submitted',                             'platform', false, null),
  ('domain.app_links',          'domain',       'assetlinks.json + apple-app-site-association published', 'For deep links',                       'platform', false, null),
  ('legal.terms_privacy',       'legal',        'Terms + Privacy pages live',               'Linked from app + store listings',                   'legal',    true, null),
  ('legal.consent_screen',      'legal',        'GDPR/PIPEDA consent screen ships',         'On first launch; re-prompt on policy change',        'legal',    true, null)
ON CONFLICT (key) DO NOTHING;
