-- Feature coverage tables: cash envelopes, remittance notebook, monthly closes, user exports
-- Applied: 2026-04-30

-- Cash Envelopes (Pakistan cash-heavy tracking)
CREATE TABLE IF NOT EXISTS cash_envelopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'PKR',
    budget_minor BIGINT NOT NULL DEFAULT 0,
    spent_minor BIGINT NOT NULL DEFAULT 0,
    period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_env_user ON cash_envelopes(user_id);

-- Remittance Notebook (manual transfer logging per product paper Gate 1)
CREATE TABLE IF NOT EXISTS remittance_notebook_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    recipient_name TEXT NOT NULL,
    recipient_country TEXT NOT NULL DEFAULT 'PK',
    relationship TEXT,
    provider TEXT NOT NULL, -- wise, remitly, western_union, xoom, other
    source_currency CHAR(3) NOT NULL,
    target_currency CHAR(3) NOT NULL DEFAULT 'PKR',
    source_amount_minor BIGINT NOT NULL,
    target_amount_minor BIGINT,
    fee_minor BIGINT,
    fx_rate NUMERIC(10, 4),
    delivery_method TEXT, -- bank_deposit, mobile_wallet, cash_pickup
    delivery_time TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'sent', 'received', 'cancelled')),
    planned_date DATE,
    sent_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    confirmation_method TEXT, -- sms, screenshot, voice, manual
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rem_notebook_user ON remittance_notebook_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_rem_notebook_status ON remittance_notebook_entries(user_id, status);

-- Monthly Closes ("Validate My Month" workflow)
CREATE TABLE IF NOT EXISTS monthly_closes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'validating', 'locked')),
    total_income_minor BIGINT,
    total_expense_minor BIGINT,
    budget_adherence_percent INTEGER,
    goal_progress_summary JSONB NOT NULL DEFAULT '{}',
    validation_checklist JSONB NOT NULL DEFAULT '[]',
    ai_summary TEXT,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_close_user ON monthly_closes(user_id, year, month);

-- User Data Exports (GDPR/data portability)
CREATE TABLE IF NOT EXISTS user_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('json', 'csv')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'expired')),
    file_path TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_exports ON user_exports(user_id, status);

-- Subscription usage tracking (for quota enforcement)
CREATE TABLE IF NOT EXISTS subscription_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,
    expense_count INTEGER NOT NULL DEFAULT 0,
    ai_query_count INTEGER NOT NULL DEFAULT 0,
    receipt_ocr_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, usage_date)
);

-- Updated triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_envelopes_updated_at BEFORE UPDATE ON cash_envelopes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER remittance_notebook_entries_updated_at BEFORE UPDATE ON remittance_notebook_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER monthly_closes_updated_at BEFORE UPDATE ON monthly_closes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
