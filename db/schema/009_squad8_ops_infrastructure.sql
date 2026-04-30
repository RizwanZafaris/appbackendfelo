-- 009_squad8_ops_infrastructure.sql — Ops Portal cross-cutting tables
CREATE TABLE IF NOT EXISTS app_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  audience JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_admin_id UUID REFERENCES admin_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_key TEXT NOT NULL,
  env TEXT NOT NULL CHECK (env IN ('dev', 'staging', 'prod')),
  encrypted_value TEXT NOT NULL,
  set_by_admin_id UUID REFERENCES admin_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT idx_vendor_env UNIQUE (vendor_key, env)
);

CREATE TABLE IF NOT EXISTS notification_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL UNIQUE,
  condition_dsl JSONB NOT NULL DEFAULT '{}',
  template_key TEXT NOT NULL,
  channel_priority JSONB NOT NULL DEFAULT '[]',
  throttle_per_day INTEGER NOT NULL DEFAULT 1,
  audience JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en TEXT NOT NULL,
  title_ur TEXT,
  body TEXT NOT NULL,
  action_url TEXT,
  audience JSONB NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: default notification triggers
INSERT INTO notification_triggers (rule_key, condition_dsl, template_key, channel_priority, throttle_per_day) VALUES
  ('budget_threshold_80', '{"type":"budget_threshold","percent":80}', 'budget_warning', '[{"channel":"push","priority":1},{"channel":"email","priority":2}]', 1),
  ('bill_due_3_days', '{"type":"bill_due","days_before":3}', 'bill_reminder', '[{"channel":"push","priority":1},{"channel":"email","priority":2}]', 1),
  ('goal_milestone_50', '{"type":"goal_milestone","percent":50}', 'goal_milestone', '[{"channel":"in_app","priority":1},{"channel":"push","priority":2}]', 1),
  ('large_transaction', '{"type":"transaction_amount","min_minor":10000000}', 'large_transaction_alert', '[{"channel":"push","priority":1}]', 5),
  ('disbursement_complete', '{"type":"disbursement_status","status":"received"}', 'disbursement_success', '[{"channel":"push","priority":1},{"channel":"email","priority":2}]', 10)
ON CONFLICT (rule_key) DO NOTHING;

-- Seed: sample announcement banner
INSERT INTO announcement_banners (title_en, title_ur, body, action_url, priority, start_at, end_at) VALUES
  ('New Feature: Family Groups', 'نیا فیچر: خاندانی گروپس', 'Share budgets and track expenses together with your family.', '/family', 1, now(), now() + interval '30 days');
