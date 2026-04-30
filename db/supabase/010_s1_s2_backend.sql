-- S1+S2 Backend Modules: SMS Parser, Receipt OCR, Statement Import, Categorization, FX Rates, Remittance, Compliance
-- Applied: 2026-05-01

-- SMS Bank Routes (sender matching)
CREATE TABLE IF NOT EXISTS sms_bank_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_pattern TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'CA',
    is_active BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SMS Parser Templates (regex patterns per bank route)
CREATE TABLE IF NOT EXISTS sms_parser_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES sms_bank_routes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    regex_pattern TEXT NOT NULL,
    field_mapping JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    accuracy_percent INTEGER,
    total_uses INTEGER NOT NULL DEFAULT 0,
    successful_uses INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SMS Ingestion Logs (user-scoped audit trail)
CREATE TABLE IF NOT EXISTS sms_ingestion_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    matched_route_id UUID REFERENCES sms_bank_routes(id),
    matched_template_id UUID REFERENCES sms_parser_templates(id),
    confidence NUMERIC(3,2),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','parsed','low_confidence','no_match','error')),
    transaction_id UUID REFERENCES transactions(id),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_log_user_created ON sms_ingestion_logs(user_id, created_at);

-- Receipts (OCR upload tracking)
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','parsing','parsed','confirmed','error')),
    parsed_data JSONB NOT NULL DEFAULT '{}',
    ocr_provider TEXT,
    transaction_id UUID REFERENCES transactions(id),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id);

-- OCR Usage Log (cost tracking per D-030)
CREATE TABLE IF NOT EXISTS ocr_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    receipt_id UUID REFERENCES receipts(id),
    provider TEXT NOT NULL,
    cost_usd_cents INTEGER,
    status TEXT NOT NULL CHECK (status IN ('success','error')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Statement Imports
CREATE TABLE IF NOT EXISTS statement_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id),
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('csv','ofx','pdf')),
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','parsing','parsed','committed','error')),
    row_count INTEGER,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER,
    parsed_rows JSONB NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stmt_import_user ON statement_imports(user_id);

-- Category Taxonomy (merchant categorization)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    label_ur TEXT,
    parent_key TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    keywords JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_category_parent ON categories(parent_key);

-- FX Rates (live/cached/fallback)
CREATE TABLE IF NOT EXISTS fx_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair TEXT NOT NULL,
    rate NUMERIC(20,10) NOT NULL,
    inverse_rate NUMERIC(20,10) NOT NULL,
    provider TEXT NOT NULL,
    source_indicator TEXT NOT NULL DEFAULT 'live' CHECK (source_indicator IN ('live','cached','seeded','fallback')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fx_pair_created ON fx_rates(pair, created_at);

-- FX Seeded Rates (offline fallback)
CREATE TABLE IF NOT EXISTS fx_seeded_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair TEXT NOT NULL UNIQUE,
    rate NUMERIC(20,10) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remittance Providers catalog
CREATE TABLE IF NOT EXISTS remittance_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    supported_source_currencies JSONB NOT NULL DEFAULT '[]',
    supported_target_currencies JSONB NOT NULL DEFAULT '[]',
    delivery_methods JSONB NOT NULL DEFAULT '[]',
    typical_fee_percent NUMERIC(5,2),
    typical_fx_spread NUMERIC(10,6),
    speed_hours_min INTEGER,
    speed_hours_max INTEGER,
    logo_url TEXT,
    website_url TEXT,
    rank INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remittance Quotes history
CREATE TABLE IF NOT EXISTS remittance_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider_code TEXT NOT NULL,
    source_currency CHAR(3) NOT NULL,
    target_currency CHAR(3) NOT NULL,
    source_amount_minor BIGINT NOT NULL,
    target_amount_minor BIGINT NOT NULL,
    fee_minor BIGINT NOT NULL,
    fx_rate NUMERIC(20,10) NOT NULL,
    speed_hours INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rem_quote_user ON remittance_quotes(user_id);

-- Compliance / AML Flags
CREATE TABLE IF NOT EXISTS compliance_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    flag_type TEXT NOT NULL CHECK (flag_type IN ('velocity','amount_threshold','frequency','pattern','manual')),
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','approved','rejected','escalated')),
    assigned_to TEXT,
    description TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}',
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comp_flag_user_status ON compliance_flags(user_id, status);
CREATE INDEX IF NOT EXISTS idx_comp_flag_status_sev ON compliance_flags(status, severity);

-- Triggers for updated_at
CREATE TRIGGER sms_bank_routes_updated_at BEFORE UPDATE ON sms_bank_routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER sms_parser_templates_updated_at BEFORE UPDATE ON sms_parser_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER receipts_updated_at BEFORE UPDATE ON receipts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER statement_imports_updated_at BEFORE UPDATE ON statement_imports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER remittance_providers_updated_at BEFORE UPDATE ON remittance_providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER compliance_flags_updated_at BEFORE UPDATE ON compliance_flags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed: default category taxonomy
INSERT INTO categories (key, label_en, parent_key, sort_order, keywords) VALUES
('income', 'Income', null, 1, '[]'),
('salary', 'Salary', 'income', 1, '["payroll","paycheque","direct deposit","wage"]'),
('freelance', 'Freelance', 'income', 2, '["gig","contract","consulting","upwork","fiverr"]'),
('food_dining', 'Food & Dining', null, 2, '["restaurant","cafe","food","meal","lunch","dinner"]'),
('groceries', 'Groceries', 'food_dining', 1, '["grocery","supermarket","walmart","loblaws","no frills"]'),
('restaurants', 'Restaurants', 'food_dining', 2, '["restaurant","mcdonalds","tim hortons","starbucks","pizza"]'),
('transport', 'Transportation', null, 3, '["gas","fuel","transit","uber","lyft","taxi"]'),
('shopping', 'Shopping', null, 4, '["retail","store","mall","purchase","amazon"]'),
('utilities', 'Utilities', null, 5, '["hydro","electric","water","gas","internet","phone","bell","rogers"]'),
('housing', 'Housing', null, 6, '["rent","mortgage","lease","property"]'),
('healthcare', 'Healthcare', null, 7, '["pharmacy","doctor","medical","dental","shoppers drug mart"]'),
('entertainment', 'Entertainment', null, 8, '["movie","netflix","spotify","game","event","ticket"]'),
('education', 'Education', null, 9, '["tuition","course","book","school","university"]'),
('finance', 'Finance', null, 10, '["bank fee","interest","investment","loan","credit card"]'),
('remittance', 'Remittance', null, 11, '["transfer","wise","remitly","ria","western union","send money"]'),
('other', 'Other', null, 99, '[]')
ON CONFLICT DO NOTHING;

-- Seed: remittance providers
INSERT INTO remittance_providers (code, name, is_active, supported_source_currencies, supported_target_currencies, delivery_methods, typical_fee_percent, typical_fx_spread, speed_hours_min, speed_hours_max, rank) VALUES
('wise', 'Wise', true, '["CAD","USD","GBP","EUR"]', '["PKR","INR","BDT","PHP"]', '["bank_deposit","mobile_wallet"]', 0.65, 0.0035, 2, 48, 1),
('remitly', 'Remitly', true, '["CAD","USD"]', '["PKR","INR","BDT","PH"]', '["bank_deposit","cash_pickup","mobile_wallet"]', 0.99, 0.0050, 3, 72, 2),
('ria', 'Ria', true, '["CAD","USD","EUR"]', '["PKR","INR","BDT","MXN"]', '["bank_deposit","cash_pickup"]', 1.50, 0.0075, 4, 96, 3),
('western_union', 'Western Union', true, '["CAD","USD","EUR","GBP"]', '["PKR","INR","BDT","PH","MXN"]', '["bank_deposit","cash_pickup","mobile_wallet"]', 2.90, 0.0100, 1, 72, 4)
ON CONFLICT DO NOTHING;

-- Seed: seeded FX rates (CAD-centric, updated periodically)
INSERT INTO fx_seeded_rates (pair, rate) VALUES
('CAD-PKR', '203.50'),
('CAD-INR', '60.85'),
('CAD-USD', '0.7342'),
('CAD-EUR', '0.6789'),
('CAD-GBP', '0.5781'),
('CAD-BDT', '86.42'),
('CAD-PHP', '42.15')
ON CONFLICT (pair) DO NOTHING;
