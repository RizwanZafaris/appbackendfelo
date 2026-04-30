-- =====================================================================
-- FELO — Full Coverage Schema Migration (008)
-- 50 tables across 7 squads: S1-Capture, S2-Remittance, S3-Identity,
-- S4-Intelligence, S5-Monetization, S6-OpsPortal, S7-Platform
-- =====================================================================
-- Applied: 2025-01-19
-- Dependencies: 007_feature_coverage.sql
-- =====================================================================

-- =====================================================================
-- S1 CAPTURE (9 tables)
-- SMS parsing, OCR receipt scanning, statement imports, categories, merchants
-- =====================================================================

-- sms_bank_routes: maps SMS sender patterns to bank parsers
CREATE TABLE IF NOT EXISTS sms_bank_routes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name           TEXT NOT NULL,
    country             CHAR(2) NOT NULL DEFAULT 'PK',
    sender_pattern      TEXT NOT NULL,
    parser_template_id  UUID,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    version             INTEGER NOT NULL DEFAULT 1,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_bank_routes_country ON sms_bank_routes(country);
CREATE INDEX IF NOT EXISTS idx_sms_bank_routes_active ON sms_bank_routes(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_bank_routes_pattern ON sms_bank_routes(country, sender_pattern);

-- sms_parser_templates: regex patterns and sample messages for parsing
CREATE TABLE IF NOT EXISTS sms_parser_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    regex_patterns      JSONB NOT NULL DEFAULT '[]',
    sample_messages     JSONB NOT NULL DEFAULT '[]',
    version             INTEGER NOT NULL DEFAULT 1,
    accuracy_score      NUMERIC(5,2),
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_parser_version ON sms_parser_templates(version);

-- sms_ingestion_log: audit trail for every SMS parsed
CREATE TABLE IF NOT EXISTS sms_ingestion_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    raw_hash            TEXT NOT NULL,
    sender              TEXT NOT NULL,
    body_preview        TEXT NOT NULL,
    parsed_at           TIMESTAMPTZ,
    parser_version      INTEGER NOT NULL DEFAULT 1,
    confidence          NUMERIC(5,4),
    transaction_id      UUID,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','parsed','failed','ignored')),
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_ingest_user ON sms_ingestion_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_ingest_status ON sms_ingestion_log(status);
CREATE INDEX IF NOT EXISTS idx_sms_ingest_created ON sms_ingestion_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_ingest_hash ON sms_ingestion_log(raw_hash);

-- receipt_uploads: OCR-scanned receipt records
CREATE TABLE IF NOT EXISTS receipt_uploads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    image_url           TEXT NOT NULL,
    ocr_provider        TEXT NOT NULL,
    ocr_response        JSONB NOT NULL DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','parsed','failed')),
    transaction_id      UUID,
    total_minor         BIGINT,
    currency            CHAR(3),
    merchant            TEXT,
    line_items          JSONB NOT NULL DEFAULT '[]',
    parsed_at           TIMESTAMPTZ,
    confidence          NUMERIC(5,4),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipt_user ON receipt_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_receipt_status ON receipt_uploads(status);
CREATE INDEX IF NOT EXISTS idx_receipt_created ON receipt_uploads(created_at DESC);

-- ocr_providers: configured OCR/vision providers
CREATE TABLE IF NOT EXISTS ocr_providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    code                TEXT NOT NULL UNIQUE,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    region              CHAR(2) NOT NULL DEFAULT 'CA',
    cost_per_call_minor BIGINT NOT NULL DEFAULT 0,
    currency            CHAR(3) NOT NULL DEFAULT 'CAD',
    daily_quota_free    INTEGER NOT NULL DEFAULT 5,
    daily_quota_plus    INTEGER NOT NULL DEFAULT 50,
    config              JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ocr_providers_active ON ocr_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_ocr_providers_region ON ocr_providers(region);

-- ocr_usage_log: per-call billing/audit for OCR
CREATE TABLE IF NOT EXISTS ocr_usage_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider_code       TEXT NOT NULL,
    receipt_upload_id   UUID REFERENCES receipt_uploads(id) ON DELETE SET NULL,
    cost_minor          BIGINT NOT NULL DEFAULT 0,
    currency            CHAR(3) NOT NULL DEFAULT 'CAD',
    status              TEXT NOT NULL DEFAULT 'success'
                        CHECK (status IN ('success','failed','refunded')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ocr_usage_user ON ocr_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_ocr_usage_provider ON ocr_usage_log(provider_code);
CREATE INDEX IF NOT EXISTS idx_ocr_usage_created ON ocr_usage_log(created_at DESC);

-- statement_imports: bank statement file uploads
CREATE TABLE IF NOT EXISTS statement_imports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    file_url            TEXT NOT NULL,
    format              TEXT NOT NULL
                        CHECK (format IN ('csv','ofx','qif','pdf','xlsx')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','parsing','parsed','failed','cancelled')),
    rows_total          INTEGER NOT NULL DEFAULT 0,
    rows_imported       INTEGER NOT NULL DEFAULT 0,
    errors              JSONB NOT NULL DEFAULT '[]',
    parsing_errors      JSONB NOT NULL DEFAULT '[]',
    parsed_rows_preview JSONB NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stmt_import_user ON statement_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_stmt_import_status ON statement_imports(status);
CREATE INDEX IF NOT EXISTS idx_stmt_import_created ON statement_imports(created_at DESC);

-- categories: master category taxonomy (en/ur bilingual)
CREATE TABLE IF NOT EXISTS categories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL UNIQUE,
    label_en            TEXT NOT NULL,
    label_ur            TEXT,
    parent_key          TEXT REFERENCES categories(key) ON DELETE SET NULL,
    icon                TEXT,
    color               TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    version             INTEGER NOT NULL DEFAULT 1,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_key);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);
CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order);

-- merchant_aliases: alias resolution for merchant normalization
CREATE TABLE IF NOT EXISTS merchant_aliases (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias                   TEXT NOT NULL,
    canonical_merchant_id   UUID,
    category_id             UUID REFERENCES categories(id) ON DELETE SET NULL,
    confidence              NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    source                  TEXT NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('manual','ml','imported')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_merchant_alias_alias ON merchant_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_merchant_alias_canon ON merchant_aliases(canonical_merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_alias_category ON merchant_aliases(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_alias_unique ON merchant_aliases(alias, canonical_merchant_id);


-- =====================================================================
-- S2 REMITTANCE (6 tables)
-- FX rates, remittance providers, compliance
-- =====================================================================

-- fx_rates: real-time and historical foreign exchange rates
CREATE TABLE IF NOT EXISTS fx_rates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair                TEXT NOT NULL,
    rate                NUMERIC(20,10) NOT NULL,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fx_pair ON fx_rates(pair);
CREATE INDEX IF NOT EXISTS idx_fx_fetched ON fx_rates(fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fx_pair_fetched ON fx_rates(pair, fetched_at);

-- fx_overrides: admin overrides for FX rates (emergency/market closure)
CREATE TABLE IF NOT EXISTS fx_overrides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair                TEXT NOT NULL,
    rate                NUMERIC(20,10) NOT NULL,
    reason              TEXT NOT NULL,
    created_by          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fx_override_pair ON fx_overrides(pair);
CREATE INDEX IF NOT EXISTS idx_fx_override_effective ON fx_overrides(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_fx_override_created_by ON fx_overrides(created_by);

-- remittance_providers: configured remittance sender services
CREATE TABLE IF NOT EXISTS remittance_providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    code                TEXT NOT NULL UNIQUE,
    country_pairs       JSONB NOT NULL DEFAULT '[]',
    fee_structure       JSONB NOT NULL DEFAULT '{}',
    eta_hours           INTEGER,
    kyc_requirements    JSONB NOT NULL DEFAULT '{}',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rem_providers_active ON remittance_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_rem_providers_code ON remittance_providers(code);

-- remittance_provider_quotes: fetched provider quotes for comparison
CREATE TABLE IF NOT EXISTS remittance_provider_quotes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider            TEXT NOT NULL,
    source              CHAR(3) NOT NULL,
    target              CHAR(3) NOT NULL,
    amount_minor        BIGINT NOT NULL,
    fee_minor           BIGINT NOT NULL DEFAULT 0,
    rate                NUMERIC(20,10) NOT NULL,
    eta_hours           INTEGER,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rem_quotes_provider ON remittance_provider_quotes(provider);
CREATE INDEX IF NOT EXISTS idx_rem_quotes_pair ON remittance_provider_quotes(source, target);
CREATE INDEX IF NOT EXISTS idx_rem_quotes_fetched ON remittance_provider_quotes(fetched_at DESC);

-- compliance_thresholds: AML/fraud threshold rules
CREATE TABLE IF NOT EXISTS compliance_thresholds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_key            TEXT NOT NULL UNIQUE,
    threshold_minor     BIGINT NOT NULL,
    window_days         INTEGER NOT NULL DEFAULT 30,
    severity            TEXT NOT NULL DEFAULT 'medium'
                        CHECK (severity IN ('low','medium','high','critical')),
    audience            JSONB NOT NULL DEFAULT '{}',
    version             INTEGER NOT NULL DEFAULT 1,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_threshold_active ON compliance_thresholds(is_active);

-- compliance_flags: triggered compliance alerts
CREATE TABLE IF NOT EXISTS compliance_flags (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rule_key            TEXT NOT NULL,
    triggered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','under_review','cleared','escalated','dismissed')),
    reviewer_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    decided_at          TIMESTAMPTZ,
    reason              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_user ON compliance_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_status ON compliance_flags(status);
CREATE INDEX IF NOT EXISTS idx_compliance_rule ON compliance_flags(rule_key);
CREATE INDEX IF NOT EXISTS idx_compliance_triggered ON compliance_flags(triggered_at DESC);


-- =====================================================================
-- S3 IDENTITY (8 tables)
-- Family groups, KYC, audit logging, PII access
-- =====================================================================

-- family_groups: extend existing table with invite_code + description
ALTER TABLE family_groups ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;
ALTER TABLE family_groups ADD COLUMN IF NOT EXISTS description TEXT;
CREATE INDEX IF NOT EXISTS idx_family_groups_code ON family_groups(invite_code);

-- family_members: extend with permissions JSONB + joined_at fix
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}';
-- family_members already has joined_at via defaultNow() in drizzle; ensure SQL side matches
ALTER TABLE family_members ALTER COLUMN joined_at SET DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_family_members_perms ON family_members USING GIN (permissions);

-- family_invitations: email/code invites to family groups
CREATE TABLE IF NOT EXISTS family_invitations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id            UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
    email               TEXT NOT NULL,
    code                TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('admin','member','viewer')),
    expires_at          TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','declined','expired')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_family_invites_group ON family_invitations(group_id);
CREATE INDEX IF NOT EXISTS idx_family_invites_email ON family_invitations(email);
CREATE INDEX IF NOT EXISTS idx_family_invites_code ON family_invitations(code);
CREATE INDEX IF NOT EXISTS idx_family_invites_status ON family_invitations(status);
CREATE INDEX IF NOT EXISTS idx_family_invites_expires ON family_invitations(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_invites_unique ON family_invitations(group_id, email);

-- family_role_permissions: RBAC matrix for family roles
CREATE TABLE IF NOT EXISTS family_role_permissions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role                TEXT NOT NULL
                        CHECK (role IN ('admin','member','viewer','owner')),
    resource            TEXT NOT NULL
                        CHECK (resource IN ('budget','transaction','goal','setting','member','invite')),
    action              TEXT NOT NULL
                        CHECK (action IN ('create','read','update','delete','manage')),
    allowed             BOOLEAN NOT NULL DEFAULT false,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_role_perms_unique
    ON family_role_permissions(role, resource, action);
CREATE INDEX IF NOT EXISTS idx_family_role_perms_role ON family_role_permissions(role);

-- kyc_documents: uploaded identity verification docs
CREATE TABLE IF NOT EXISTS kyc_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    doc_type            TEXT NOT NULL
                        CHECK (doc_type IN ('passport','drivers_license','national_id','utility_bill','selfie','other')),
    file_url            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','under_review','approved','rejected')),
    vendor_response     JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_doc_user ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_doc_status ON kyc_documents(status);
CREATE INDEX IF NOT EXISTS idx_kyc_doc_type ON kyc_documents(doc_type);

-- kyc_decisions: final KYC approval/rejection records
CREATE TABLE IF NOT EXISTS kyc_decisions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status              TEXT NOT NULL
                        CHECK (status IN ('approved','rejected','manual_review')),
    decided_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewer_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, status)
);
CREATE INDEX IF NOT EXISTS idx_kyc_decision_user ON kyc_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_decision_reviewer ON kyc_decisions(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_kyc_decision_status ON kyc_decisions(status);

-- audit_log: comprehensive audit trail for all mutations
CREATE TABLE IF NOT EXISTS audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
    entity_type         TEXT NOT NULL,
    entity_id           UUID,
    operation           TEXT NOT NULL
                        CHECK (operation IN ('create','read','update','delete','login','logout','export')),
    before_state        JSONB,
    after_state         JSONB,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_operation ON audit_log(operation);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- pii_access_log: track admin access to PII (GDPR compliance)
CREATE TABLE IF NOT EXISTS pii_access_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    target_user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    fields              JSONB NOT NULL DEFAULT '[]',
    reason              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pii_admin ON pii_access_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_pii_target ON pii_access_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_pii_created ON pii_access_log(created_at DESC);


-- =====================================================================
-- S4 INTELLIGENCE (13 tables)
-- Felo scores, coaching, reports, market data, portfolio
-- =====================================================================

-- felo_score_history: time-series record of computed Felo scores
CREATE TABLE IF NOT EXISTS felo_score_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    score               INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000),
    components          JSONB NOT NULL DEFAULT '{}',
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    formula_version     INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_felo_hist_user ON felo_score_history(user_id);
CREATE INDEX IF NOT EXISTS idx_felo_hist_computed ON felo_score_history(computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_felo_hist_formula ON felo_score_history(formula_version);

-- felo_score_formula: versioned scoring algorithm weights
CREATE TABLE IF NOT EXISTS felo_score_formula (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version             INTEGER NOT NULL UNIQUE,
    weights             JSONB NOT NULL DEFAULT '{}',
    thresholds          JSONB NOT NULL DEFAULT '{}',
    rolled_out_at       TIMESTAMPTZ,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_felo_formula_version ON felo_score_formula(version);

-- budget_defaults: corridor/cohort-specific budget threshold defaults
CREATE TABLE IF NOT EXISTS budget_defaults (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corridor            TEXT NOT NULL
                        CHECK (corridor IN ('canada','pakistan','other')),
    cohort              TEXT NOT NULL DEFAULT 'all',
    threshold_pct       INTEGER NOT NULL DEFAULT 80 CHECK (threshold_pct BETWEEN 1 AND 100),
    alert_channel       JSONB NOT NULL DEFAULT '["push"]',
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_defaults_unique
    ON budget_defaults(corridor, cohort);

-- goal_nudge_templates: behavioral nudge templates for goal progress
CREATE TABLE IF NOT EXISTS goal_nudge_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL UNIQUE,
    cadence_days        INTEGER NOT NULL DEFAULT 7,
    copy_key            TEXT NOT NULL,
    channel             TEXT NOT NULL DEFAULT 'push'
                        CHECK (channel IN ('push','email','inapp','sms')),
    audience            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goal_nudge_key ON goal_nudge_templates(key);

-- bill_detection_rules: regex patterns for recurring bill detection
CREATE TABLE IF NOT EXISTS bill_detection_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    regex               TEXT NOT NULL,
    category_key        TEXT NOT NULL,
    recurrence_hint     TEXT NOT NULL DEFAULT 'monthly'
                        CHECK (recurrence_hint IN ('weekly','monthly','quarterly','yearly')),
    version             INTEGER NOT NULL DEFAULT 1,
    audience            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bill_detect_category ON bill_detection_rules(category_key);
CREATE INDEX IF NOT EXISTS idx_bill_detect_version ON bill_detection_rules(version);

-- coach_prompt_templates: versioned LLM prompt templates
CREATE TABLE IF NOT EXISTS coach_prompt_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    body                TEXT NOT NULL,
    variables           JSONB NOT NULL DEFAULT '[]',
    model               TEXT NOT NULL DEFAULT 'gpt-4o',
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','deprecated')),
    canary_pct          INTEGER NOT NULL DEFAULT 0 CHECK (canary_pct BETWEEN 0 AND 100),
    audience            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(key, version)
);
CREATE INDEX IF NOT EXISTS idx_coach_prompt_key ON coach_prompt_templates(key);
CREATE INDEX IF NOT EXISTS idx_coach_prompt_status ON coach_prompt_templates(status);
CREATE INDEX IF NOT EXISTS idx_coach_prompt_key_version ON coach_prompt_templates(key, version);

-- coach_guardrail_rules: safety/guardrail layers for coach LLM
CREATE TABLE IF NOT EXISTS coach_guardrail_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer               TEXT NOT NULL
                        CHECK (layer IN ('input','retrieval','generation','output')),
    rule_key            TEXT NOT NULL UNIQUE,
    severity            TEXT NOT NULL DEFAULT 'block'
                        CHECK (severity IN ('warn','block','log_only')),
    action              TEXT NOT NULL DEFAULT 'refuse'
                        CHECK (action IN ('refuse','sanitize','flag','allow')),
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_guard_layer ON coach_guardrail_rules(layer);
CREATE INDEX IF NOT EXISTS idx_coach_guard_severity ON coach_guardrail_rules(severity);

-- coach_tools: function-calling tool definitions for coach agent
CREATE TABLE IF NOT EXISTS coach_tools (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL UNIQUE,
    db_query            TEXT NOT NULL,
    allowed_fields      JSONB NOT NULL DEFAULT '[]',
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_tools_key ON coach_tools(key);

-- coach_eval_results: offline evaluation results for prompt versions
CREATE TABLE IF NOT EXISTS coach_eval_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_version    INTEGER NOT NULL,
    eval_id             TEXT NOT NULL,
    score               NUMERIC(5,4) NOT NULL,
    passed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_eval_version ON coach_eval_results(template_version);
CREATE INDEX IF NOT EXISTS idx_coach_eval_passed ON coach_eval_results(passed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_eval_unique ON coach_eval_results(template_version, eval_id);

-- coach_conversations: extend existing table with prompt_version, token_count, cost_minor
ALTER TABLE coach_conversations ADD COLUMN IF NOT EXISTS prompt_version INTEGER;
ALTER TABLE coach_conversations ADD COLUMN IF NOT EXISTS token_count INTEGER;
ALTER TABLE coach_conversations ADD COLUMN IF NOT EXISTS cost_minor BIGINT;
ALTER TABLE coach_conversations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_coach_conv_version ON coach_conversations(prompt_version);

-- report_templates: user-facing report layout templates
CREATE TABLE IF NOT EXISTS report_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    layout              JSONB NOT NULL DEFAULT '{}',
    copy_key            TEXT NOT NULL,
    locale              TEXT NOT NULL DEFAULT 'en',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(key, version, locale)
);
CREATE INDEX IF NOT EXISTS idx_report_key ON report_templates(key);
CREATE INDEX IF NOT EXISTS idx_report_locale ON report_templates(locale);

-- market_quotes: real-time market price snapshots
CREATE TABLE IF NOT EXISTS market_quotes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              TEXT NOT NULL,
    price               NUMERIC(20,10) NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'CAD',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_market_symbol ON market_quotes(symbol);
CREATE INDEX IF NOT EXISTS idx_market_fetched ON market_quotes(fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_symbol_fetched ON market_quotes(symbol, fetched_at, source);

-- portfolio_holdings: user investment positions
CREATE TABLE IF NOT EXISTS portfolio_holdings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    symbol              TEXT NOT NULL,
    quantity            NUMERIC(20,8) NOT NULL,
    cost_basis_minor    BIGINT NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'CAD',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio_holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_symbol ON portfolio_holdings(symbol);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_user_symbol ON portfolio_holdings(user_id, symbol);


-- =====================================================================
-- S5 MONETIZATION (4 tables)
-- Tiers, coupons, approvals, paywall A/B
-- =====================================================================

-- subscription_tiers: plan definitions with entitlements
CREATE TABLE IF NOT EXISTS subscription_tiers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL UNIQUE,
    label_key           TEXT NOT NULL,
    price_minor         BIGINT NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'CAD',
    entitlements        JSONB NOT NULL DEFAULT '{}',
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sub_tiers_key ON subscription_tiers(key);
CREATE INDEX IF NOT EXISTS idx_sub_tiers_version ON subscription_tiers(version);

-- coupons: discount/promo codes
CREATE TABLE IF NOT EXISTS coupons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT NOT NULL UNIQUE,
    discount_type       TEXT NOT NULL
                        CHECK (discount_type IN ('percentage','fixed_amount','free_months')),
    discount_value      BIGINT NOT NULL,
    valid_until         TIMESTAMPTZ,
    audience            JSONB NOT NULL DEFAULT '{}',
    usage_count         INTEGER NOT NULL DEFAULT 0,
    max_uses            INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_valid ON coupons(valid_until);
CREATE INDEX IF NOT EXISTS idx_coupons_uses ON coupons(usage_count, max_uses);

-- approval_requests: two-person approval workflow requests
CREATE TABLE IF NOT EXISTS approval_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                TEXT NOT NULL
                        CHECK (type IN ('coupon_override','refund','kyc_fast_track','compliance_override','pii_access')),
    payload             JSONB NOT NULL DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','expired')),
    requested_by        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    approver_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    decided_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requester ON approval_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_approval_type ON approval_requests(type);
CREATE INDEX IF NOT EXISTS idx_approval_created ON approval_requests(created_at DESC);

-- paywall_variants: A/B tested paywall layouts
CREATE TABLE IF NOT EXISTS paywall_variants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL,
    layout              JSONB NOT NULL DEFAULT '{}',
    audience            JSONB NOT NULL DEFAULT '{}',
    ab_split            NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    impressions         BIGINT NOT NULL DEFAULT 0,
    conversions         BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_paywall_key ON paywall_variants(key);
CREATE INDEX IF NOT EXISTS idx_paywall_active ON paywall_variants(is_active);


-- =====================================================================
-- S6 OPS PORTAL (3 tables)
-- Admin users, sessions, two-person approval
-- =====================================================================

-- admin_users: backoffice admin accounts (separate from app users)
CREATE TABLE IF NOT EXISTS admin_users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_id             TEXT UNIQUE,
    email                   TEXT NOT NULL UNIQUE,
    display_name            TEXT,
    role                    TEXT NOT NULL DEFAULT 'analyst'
                            CHECK (role IN ('super_admin','admin','analyst','support')),
    permissions             JSONB NOT NULL DEFAULT '{}',
    is_active               BOOLEAN NOT NULL DEFAULT true,
    last_login_at           TIMESTAMPTZ,
    webauthn_credential_id  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_role ON admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_active ON admin_users(is_active);

-- admin_sessions: session tokens for ops portal
CREATE TABLE IF NOT EXISTS admin_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id       UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token               TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_session_user ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_session_token ON admin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_admin_session_expires ON admin_sessions(expires_at);

-- two_person_approvals: pending second-person sign-off records
CREATE TABLE IF NOT EXISTS two_person_approvals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_type        TEXT NOT NULL
                        CHECK (request_type IN ('config_change','data_migration','bulk_delete','rate_override','role_change')),
    target_id           TEXT,
    proposed_changes    JSONB NOT NULL DEFAULT '{}',
    requester_id        UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    approver_id         UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','expired','superseded')),
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_two_person_type ON two_person_approvals(request_type);
CREATE INDEX IF NOT EXISTS idx_two_person_status ON two_person_approvals(status);
CREATE INDEX IF NOT EXISTS idx_two_person_requester ON two_person_approvals(requester_id);
CREATE INDEX IF NOT EXISTS idx_two_person_expires ON two_person_approvals(expires_at);


-- =====================================================================
-- S7 PLATFORM (7 tables)
-- Notifications, i18n, feature flags, retention, analytics taxonomy
-- =====================================================================

-- notification_templates: multi-channel message templates (en + ur)
CREATE TABLE IF NOT EXISTS notification_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL UNIQUE,
    channel             TEXT NOT NULL
                        CHECK (channel IN ('push','email','inapp','sms')),
    title_en            TEXT NOT NULL,
    title_ur            TEXT,
    body_en             TEXT NOT NULL,
    body_ur             TEXT,
    variables           JSONB NOT NULL DEFAULT '[]',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_tmpl_key ON notification_templates(key);
CREATE INDEX IF NOT EXISTS idx_notif_tmpl_channel ON notification_templates(channel);
CREATE INDEX IF NOT EXISTS idx_notif_tmpl_active ON notification_templates(is_active);

-- announcement_banners: in-app banner announcements
CREATE TABLE IF NOT EXISTS announcement_banners (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_en            TEXT NOT NULL,
    title_ur            TEXT,
    body_en             TEXT NOT NULL,
    body_ur             TEXT,
    action_url          TEXT,
    audience_filter     JSONB NOT NULL DEFAULT '{}',
    priority            INTEGER NOT NULL DEFAULT 0,
    start_at            TIMESTAMPTZ,
    end_at              TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announce_active ON announcement_banners(is_active);
CREATE INDEX IF NOT EXISTS idx_announce_priority ON announcement_banners(priority DESC);
CREATE INDEX IF NOT EXISTS idx_announce_schedule ON announcement_banners(start_at, end_at);

-- engagement_campaigns: scheduled notification campaigns
CREATE TABLE IF NOT EXISTS engagement_campaigns (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    audience_filter     JSONB NOT NULL DEFAULT '{}',
    template_id         UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
    schedule_type       TEXT NOT NULL DEFAULT 'immediate'
                        CHECK (schedule_type IN ('immediate','once','recurring')),
    scheduled_at        TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled')),
    metrics             JSONB NOT NULL DEFAULT '{}',
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON engagement_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_scheduled ON engagement_campaigns(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_campaign_created_by ON engagement_campaigns(created_by);

-- i18n_strings: bilingual string resources (en + ur)
CREATE TABLE IF NOT EXISTS i18n_strings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL UNIQUE,
    value_en            TEXT NOT NULL,
    value_ur            TEXT,
    context             TEXT,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_i18n_key ON i18n_strings(key);
CREATE INDEX IF NOT EXISTS idx_i18n_version ON i18n_strings(version);

-- feature_flags: kill-switches and gradual rollouts
CREATE TABLE IF NOT EXISTS feature_flags (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 TEXT NOT NULL UNIQUE,
    description         TEXT,
    is_enabled          BOOLEAN NOT NULL DEFAULT false,
    targeting           JSONB NOT NULL DEFAULT '{}',
    kill_switch         BOOLEAN NOT NULL DEFAULT false,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feature_flag_key ON feature_flags(key);
CREATE INDEX IF NOT EXISTS idx_feature_flag_enabled ON feature_flags(is_enabled);
CREATE INDEX IF NOT EXISTS idx_feature_flag_kill ON feature_flags(kill_switch);

-- data_retention_policies: GDPR/auto-delete configuration
CREATE TABLE IF NOT EXISTS data_retention_policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         TEXT NOT NULL UNIQUE,
    retention_days      INTEGER NOT NULL,
    auto_delete         BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retention_entity ON data_retention_policies(entity_type);

-- analytics_event_taxonomy: validated event schema registry
CREATE TABLE IF NOT EXISTS analytics_event_taxonomy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name          TEXT NOT NULL UNIQUE,
    category            TEXT NOT NULL
                        CHECK (category IN ('onboarding','transaction','budget','goal','coach','remittance','subscription','engagement','system')),
    properties_schema   JSONB NOT NULL DEFAULT '{}',
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_event_taxonomy(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_category ON analytics_event_taxonomy(category);


-- =====================================================================
-- Updated triggers for new tables that need updated_at
-- =====================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to tables that have updated_at columns
-- Note: most new tables are append-only (audit logs, history) and don't need updated_at

-- =====================================================================
-- Migration complete
-- =====================================================================
