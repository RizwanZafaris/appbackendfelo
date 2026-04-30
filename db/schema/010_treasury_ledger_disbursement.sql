-- 010_treasury_ledger_disbursement.sql — Squad 2/3/4 back-office subsystem
-- Self-contained: ledger, treasury, deals, disbursement, plus integer-PK
-- treasury_actors and treasury_audit_logs (kept separate from app-level
-- profiles/audit_log to preserve UUID model on the user-facing side).

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'inactive');
CREATE TYPE kyc_tier AS ENUM ('none', 'basic', 'verified', 'premium');
CREATE TYPE audit_action AS ENUM (
  'user_created', 'user_updated', 'user_deleted',
  'kyc_submitted', 'kyc_approved', 'kyc_rejected',
  'transaction_created', 'transaction_updated', 'transaction_deleted',
  'ledger_entry_created', 'ledger_entry_reversed',
  'deal_booked', 'deal_settled', 'deal_cancelled',
  'disbursement_created', 'disbursement_sent', 'disbursement_received',
  'disbursement_cancelled', 'disbursement_retried', 'disbursement_failed'
);
CREATE TYPE ledger_account_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
CREATE TYPE ledger_normal_side AS ENUM ('debit', 'credit');
CREATE TYPE deal_status AS ENUM ('draft', 'booked', 'settled', 'cancelled');
CREATE TYPE disbursement_method_type AS ENUM ('wallet', 'bank', 'cash_otc');
CREATE TYPE disbursement_order_status AS ENUM ('pending', 'sent', 'received', 'cancelled', 'failed');

CREATE TABLE IF NOT EXISTS treasury_actors (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255),
  status user_status NOT NULL DEFAULT 'active',
  kyc_tier kyc_tier NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS treasury_actors_email_idx ON treasury_actors(email);

CREATE TABLE IF NOT EXISTS treasury_audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES treasury_actors(id),
  action audit_action NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id INTEGER,
  payload JSONB,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS treasury_audit_logs_actor_id_idx ON treasury_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS treasury_audit_logs_action_idx ON treasury_audit_logs(action);
CREATE INDEX IF NOT EXISTS treasury_audit_logs_entity_idx ON treasury_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS treasury_audit_logs_created_at_idx ON treasury_audit_logs(created_at);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES treasury_actors(id),
  type ledger_account_type NOT NULL,
  normal_side ledger_normal_side NOT NULL,
  parent_id INTEGER REFERENCES ledger_accounts(id),
  currency VARCHAR(3) NOT NULL,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_accounts_actor_id_idx ON ledger_accounts(actor_id);
CREATE INDEX IF NOT EXISTS ledger_accounts_type_idx ON ledger_accounts(type);
CREATE INDEX IF NOT EXISTS ledger_accounts_currency_idx ON ledger_accounts(currency);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id SERIAL PRIMARY KEY,
  transaction_id VARCHAR(64) NOT NULL,
  ledger_account_id INTEGER NOT NULL REFERENCES ledger_accounts(id),
  debit_minor BIGINT NOT NULL DEFAULT 0,
  credit_minor BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversal_of INTEGER REFERENCES ledger_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_transaction_id_idx ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_ledger_account_id_idx ON ledger_entries(ledger_account_id);
CREATE INDEX IF NOT EXISTS ledger_entries_posted_at_idx ON ledger_entries(posted_at);
CREATE INDEX IF NOT EXISTS ledger_entries_reversal_of_idx ON ledger_entries(reversal_of);

CREATE TABLE IF NOT EXISTS treasury_accounts (
  id SERIAL PRIMARY KEY,
  currency VARCHAR(3) NOT NULL UNIQUE,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  bank_name VARCHAR(255),
  account_no_masked VARCHAR(64),
  country VARCHAR(2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  source_currency VARCHAR(3) NOT NULL,
  target_currency VARCHAR(3) NOT NULL,
  source_amount_minor BIGINT NOT NULL,
  target_amount_minor BIGINT NOT NULL,
  our_rate NUMERIC(18, 8) NOT NULL,
  market_rate NUMERIC(18, 8) NOT NULL,
  margin_bps INTEGER NOT NULL,
  status deal_status NOT NULL DEFAULT 'draft',
  booked_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deals_status_idx ON deals(status);
CREATE INDEX IF NOT EXISTS deals_currencies_idx ON deals(source_currency, target_currency);

CREATE TABLE IF NOT EXISTS disbursement_methods (
  id SERIAL PRIMARY KEY,
  type disbursement_method_type NOT NULL,
  provider VARCHAR(128) NOT NULL,
  country VARCHAR(2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  supports_currencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disbursement_methods_type_country_idx ON disbursement_methods(type, country);

CREATE TABLE IF NOT EXISTS disbursement_orders (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES treasury_actors(id),
  deal_id INTEGER REFERENCES deals(id),
  method_id INTEGER NOT NULL REFERENCES disbursement_methods(id),
  amount_minor BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status disbursement_order_status NOT NULL DEFAULT 'pending',
  provider_ref VARCHAR(255),
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disbursement_orders_actor_id_idx ON disbursement_orders(actor_id);
CREATE INDEX IF NOT EXISTS disbursement_orders_deal_id_idx ON disbursement_orders(deal_id);
CREATE INDEX IF NOT EXISTS disbursement_orders_status_idx ON disbursement_orders(status);
