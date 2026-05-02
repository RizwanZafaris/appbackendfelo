import { pgTable, uuid, varchar, boolean, jsonb, integer, timestamp, text, numeric } from 'drizzle-orm/pg-core';

export const remittanceProviders = pgTable('remittance_providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  providerCode: varchar('provider_code', { length: 50 }).notNull().unique(),
  enabled: boolean('enabled').default(true).notNull(),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  authType: varchar('auth_type', { length: 20 }).notNull(), // oauth2, apikey, hmac, basic, otp_token
  credentials: jsonb('credentials').notNull().$type<Record<string, string>>(),
  supportedCorridors: jsonb('supported_corridors').notNull().$type<string[]>(),
  supportedCurrencies: jsonb('supported_currencies').notNull().$type<string[]>(),
  payoutMethods: jsonb('payout_methods').notNull().$type<string[]>(),
  rateLimitPerMin: integer('rate_limit_per_min').default(60),
  webhookUrl: varchar('webhook_url', { length: 500 }),
  ipWhitelist: jsonb('ip_whitelist').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const remittanceRoutes = pgTable('remittance_routes', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  corridor: varchar('corridor', { length: 20 }).notNull(), // e.g. "AE-PK", "SA-BD"
  sourceCurrency: varchar('source_currency', { length: 3 }).notNull(),
  targetCurrency: varchar('target_currency', { length: 3 }).notNull(),
  providerId: uuid('provider_id').references(() => remittanceProviders.id).notNull(),
  payoutMethod: varchar('payout_method', { length: 30 }).notNull(), // bank_transfer, cash_pickup, mobile_wallet, card
  feeBps: integer('fee_bps').default(50), // 0.50%
  fxMarkupBps: integer('fx_markup_bps').default(100), // 1.00%
  minAmount: numeric('min_amount', { precision: 14, scale: 2 }).default('10'),
  maxAmount: numeric('max_amount', { precision: 14, scale: 2 }).default('10000'),
  estimatedMinutes: integer('estimated_minutes').default(30),
  enabled: boolean('enabled').default(true).notNull(),
  priority: integer('priority').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const remittanceTransactions = pgTable('remittance_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  reference: varchar('reference', { length: 100 }).notNull().unique(),
  userId: uuid('user_id').notNull(),
  providerId: uuid('provider_id').references(() => remittanceProviders.id).notNull(),
  routeId: uuid('route_id').references(() => remittanceRoutes.id),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, initiated, completed, failed, reversed
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  targetAmount: numeric('target_amount', { precision: 14, scale: 2 }),
  targetCurrency: varchar('target_currency', { length: 3 }),
  exchangeRate: numeric('exchange_rate', { precision: 14, scale: 6 }),
  feeAmount: numeric('fee_amount', { precision: 14, scale: 2 }).default('0'),
  feeBps: integer('fee_bps').default(0),
  providerTransactionId: varchar('provider_transaction_id', { length: 200 }),
  providerStatus: varchar('provider_status', { length: 50 }),
  providerRawResponse: jsonb('provider_raw_response'),
  recipientName: varchar('recipient_name', { length: 200 }).notNull(),
  recipientAccount: varchar('recipient_account', { length: 200 }).notNull(),
  recipientPhone: varchar('recipient_phone', { length: 50 }),
  recipientBankCode: varchar('recipient_bank_code', { length: 20 }),
  recipientBankName: varchar('recipient_bank_name', { length: 100 }),
  purpose: varchar('purpose', { length: 200 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  webhookDelivered: boolean('webhook_delivered').default(false),
  webhookAttempts: integer('webhook_attempts').default(0),
  completedAt: timestamp('completed_at'),
  failedAt: timestamp('failed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 100 }),
  phone: varchar('phone', { length: 50 }),
  kycStatus: varchar('kyc_status', { length: 20 }).default('pending').notNull(),
  sumsubApplicantId: varchar('sumsub_applicant_id', { length: 100 }),
  kycCompletedAt: timestamp('kyc_completed_at'),
  kycRejectedAt: timestamp('kyc_rejected_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const kycDocuments = pgTable('kyc_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => profiles.id).notNull(),
  applicantId: varchar('applicant_id', { length: 100 }).notNull(),
  reviewStatus: varchar('review_status', { length: 20 }).notNull(),
  reviewResult: jsonb('review_result').$type<Record<string, unknown>>(),
  webhookPayload: jsonb('webhook_payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── In-House KYC / KYB / TMS Tables ───────────────────────────────

export const kycProfiles = pgTable('kyc_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique(),
  fullName: varchar('full_name', { length: 200 }).notNull(),
  dob: varchar('dob', { length: 10 }),
  nationality: varchar('nationality', { length: 3 }),
  address: text('address'),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, in_review, approved, rejected, needs_info
  reviewerId: uuid('reviewer_id'),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const kycDocumentItems = pgTable('kyc_document_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  profileId: uuid('profile_id').references(() => kycProfiles.id).notNull(),
  type: varchar('type', { length: 30 }).notNull(), // passport, id_card, proof_of_address, selfie, driving_license
  fileUrl: varchar('file_url', { length: 500 }),
  fileKey: varchar('file_key', { length: 200 }),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, verified, rejected
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  verifiedAt: timestamp('verified_at'),
  reviewerNotes: text('reviewer_notes'),
});

export const kybBusinesses = pgTable('kyb_businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessName: varchar('business_name', { length: 200 }).notNull(),
  registrationNumber: varchar('registration_number', { length: 100 }).notNull(),
  country: varchar('country', { length: 3 }).notNull(),
  businessType: varchar('business_type', { length: 50 }).notNull(), // llc, corporation, partnership, sole_proprietorship
  tradeLicense: varchar('trade_license', { length: 100 }),
  incorporationDate: varchar('incorporation_date', { length: 10 }),
  address: text('address'),
  website: varchar('website', { length: 200 }),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  reviewerId: uuid('reviewer_id'),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const kybUbos = pgTable('kyb_ubos', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => kybBusinesses.id).notNull(),
  fullName: varchar('full_name', { length: 200 }).notNull(),
  dob: varchar('dob', { length: 10 }),
  nationality: varchar('nationality', { length: 3 }),
  ownershipPercentage: numeric('ownership_percentage', { precision: 5, scale: 2 }).notNull(),
  kycProfileId: uuid('kyc_profile_id').references(() => kycProfiles.id),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const kybBusinessDocs = pgTable('kyb_business_docs', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => kybBusinesses.id).notNull(),
  type: varchar('type', { length: 30 }).notNull(), // trade_license, articles_of_incorporation, bank_statement, financial_statement
  fileUrl: varchar('file_url', { length: 500 }),
  fileKey: varchar('file_key', { length: 200 }),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  verifiedAt: timestamp('verified_at'),
  reviewerNotes: text('reviewer_notes'),
});

export const tmsRules = pgTable('tms_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 30 }).notNull(), // velocity, threshold, pattern, geographic, new_user, sanctions
  config: jsonb('config').notNull().$type<Record<string, unknown>>(),
  isActive: boolean('is_active').default(true).notNull(),
  priority: integer('priority').default(0),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const tmsAlerts = pgTable('tms_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleId: uuid('rule_id').references(() => tmsRules.id).notNull(),
  transactionId: uuid('transaction_id').references(() => remittanceTransactions.id),
  userId: uuid('user_id').notNull(),
  riskScore: integer('risk_score').default(0).notNull(),
  status: varchar('status', { length: 30 }).default('open').notNull(), // open, under_review, confirmed, false_positive
  assignedTo: uuid('assigned_to'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

export const tmsCases = pgTable('tms_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseNumber: varchar('case_number', { length: 50 }).notNull().unique(),
  status: varchar('status', { length: 20 }).default('open').notNull(), // open, in_progress, closed
  priority: varchar('priority', { length: 10 }).default('medium').notNull(), // low, medium, high, critical
  assignedTo: uuid('assigned_to'),
  notes: text('notes'),
  linkedAlertIds: jsonb('linked_alert_ids').notNull().$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
});

export const tmsSanctions = pgTable('tms_sanctions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  listType: varchar('list_type', { length: 10 }).notNull(), // ofac, un, eu, hmt
  entityName: varchar('entity_name', { length: 200 }).notNull(),
  aliases: jsonb('aliases').$type<string[]>(),
  program: varchar('program', { length: 100 }),
  riskLevel: varchar('risk_level', { length: 10 }).default('medium').notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
});

export const complianceConfig = pgTable('compliance_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  section: varchar('section', { length: 30 }).notNull(), // kyc, kyb, tms
  config: jsonb('config').notNull().$type<Record<string, unknown>>(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
