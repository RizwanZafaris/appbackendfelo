/**
 * Felo — canonical database schema (Path A: Supabase Auth).
 *
 * Mirrors the live SQL applied at db/supabase/000_init.sql exactly. The
 * source of truth for queries is this file; for RLS policies + triggers
 * it's the SQL file. Keep them in lockstep.
 *
 * Identity model: profiles.id IS auth.users.id (Supabase Auth pattern).
 * Money convention: BIGINT minor units (cents/paisa), never floats.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// -- PROFILES (1:1 with auth.users) -------------------------------------
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(), // FK to auth.users(id) enforced in SQL
  email: text('email'),
  displayName: text('display_name'),
  phoneE164: text('phone_e164'),
  monthlyIncomeMinor: bigint('monthly_income_minor', { mode: 'number' }),
  currency: char('currency', { length: 3 }).notNull().default('CAD'),
  country: text('country'),
  corridor: text('corridor', { enum: ['canada', 'pakistan', 'other'] })
    .notNull()
    .default('other'),
  languageCode: text('language_code').notNull().default('en'),
  feloScore: integer('felo_score'),
  subscriptionTier: text('subscription_tier').notNull().default('free'),
  kycStatus: text('kyc_status', {
    enum: ['not_started', 'in_progress', 'submitted', 'approved', 'rejected'],
  })
    .notNull()
    .default('not_started'),
  sumsubApplicantId: text('sumsub_applicant_id').unique(),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  // Flexible settings blob — added in 005_profile_settings.sql.
  // Validated client-side by ProfileSettings (freezed) in the Flutter app.
  settings: jsonb('settings').notNull().default({
    themeMode: 'system',
    operationalNotifications: true,
    marketingConsent: false,
    smsParserEnabled: false,
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// -- ACCOUNTS -----------------------------------------------------------
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    // Display category — added in 004_accounts_metadata.sql.
    type: text('type', { enum: ['bank', 'card', 'wallet'] }),
    displayName: text('display_name'),
    currency: char('currency', { length: 3 }).notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'number' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    // Aggregator sync state — added in 004_accounts_metadata.sql.
    syncStatus: text('sync_status', {
      enum: ['synced', 'syncing', 'needs_review'],
    })
      .notNull()
      .default('synced'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_accounts_user').on(t.userId),
  }),
);

// -- TRANSACTIONS -------------------------------------------------------
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id),
    merchant: text('merchant'),
    category: text('category'),
    userCategory: text('user_category'),
    currency: char('currency', { length: 3 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    direction: text('direction', { enum: ['debit', 'credit'] }).notNull(),
    source: text('source', {
      enum: ['sms', 'manual', 'bank_alert', 'ocr', 'import'],
    }).notNull(),
    rawSms: text('raw_sms'),
    parserConfidence: numeric('parser_confidence', { precision: 3, scale: 2 }),
    bookedAt: timestamp('booked_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    receiptUrl: text('receipt_url'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    userBookedIdx: index('idx_txn_user_booked').on(t.userId, t.bookedAt),
    userUpdatedIdx: index('idx_txn_user_updated').on(t.userId, t.updatedAt),
  }),
);

// -- BUDGETS ------------------------------------------------------------
export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    limitMinor: bigint('limit_minor', { mode: 'number' }).notNull(),
    period: text('period', { enum: ['weekly', 'monthly', 'custom'] }).notNull(),
    rolloverEnabled: boolean('rollover_enabled').notNull().default(false),
    alertThresholdPercent: integer('alert_threshold_percent').notNull().default(80),
    startsOn: date('starts_on').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_budgets_user').on(t.userId),
  }),
);

// -- GOALS --------------------------------------------------------------
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    currency: char('currency', { length: 3 }).notNull(),
    targetMinor: bigint('target_minor', { mode: 'number' }).notNull(),
    savedMinor: bigint('saved_minor', { mode: 'number' }).notNull().default(0),
    targetDate: date('target_date'),
    cadence: text('cadence', { enum: ['weekly', 'monthly', 'manual'] })
      .notNull()
      .default('manual'),
    shared: boolean('shared').notNull().default(false),
    isCompleted: boolean('is_completed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_goals_user').on(t.userId),
  }),
);

// -- FELO SCORES --------------------------------------------------------
export const feloScores = pgTable(
  'felo_scores',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    savingsRate: integer('savings_rate'),
    budgetAdherence: integer('budget_adherence'),
    expenseVolatility: integer('expense_volatility'),
    billConsistency: integer('bill_consistency'),
    goalProgress: integer('goal_progress'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCalcIdx: index('idx_felo_scores_user').on(t.userId, t.calculatedAt),
  }),
);

// -- RECURRING BILLS ----------------------------------------------------
export const recurringBills = pgTable(
  'recurring_bills',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    merchant: text('merchant').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    category: text('category'),
    frequency: text('frequency', {
      enum: ['weekly', 'monthly', 'quarterly', 'yearly'],
    }).notNull(),
    nextExpected: date('next_expected'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_recurring_user').on(t.userId),
  }),
);

// -- SUBSCRIPTIONS ------------------------------------------------------
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull(),
  status: text('status', {
    enum: ['trialing', 'active', 'past_due', 'canceled', 'expired'],
  }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  paymentProvider: text('payment_provider'),
  externalId: text('external_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -- COACH MEMORY -------------------------------------------------------
export const coachConversations = pgTable(
  'coach_conversations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    promptVersion: integer('prompt_version'),
    messages: jsonb('messages').notNull().default([]),
    tokenCount: integer('token_count'),
    costMinor: bigint('cost_minor', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUpdatedIdx: index('idx_coach_conv_user').on(t.userId, t.updatedAt),
    versionIdx: index('idx_coach_conv_version').on(t.promptVersion),
  }),
);

export const coachQueries = pgTable(
  'coach_queries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    queryDate: date('query_date').notNull(),
    queryCount: integer('query_count').notNull().default(1),
  },
  (t) => ({
    userDateUnique: uniqueIndex('idx_coach_queries_user_date').on(t.userId, t.queryDate),
  }),
);

// -- FAMILY -------------------------------------------------------------
export const familyGroups = pgTable('family_groups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => profiles.id),
  name: text('name'),
  inviteCode: text('invite_code').unique(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    groupId: uuid('group_id')
      .notNull()
      .references(() => familyGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id),
    role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull(),
    permissions: jsonb('permissions').notNull().default({}),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyUserUnique: uniqueIndex('idx_family_members_unique').on(t.groupId, t.userId),
    userIdx: index('idx_family_members_user').on(t.userId),
  }),
);

export const consentEvents = pgTable('consent_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: uuid('actor_user_id').notNull(),
  subjectUserId: uuid('subject_user_id').notNull(),
  resourceType: text('resource_type'),
  resourceId: uuid('resource_id'),
  action: text('action'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').notNull().default({}),
});

// -- NOTIFICATIONS + DEVICES -------------------------------------------
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: ['push', 'email', 'inapp', 'sms'] }).notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  payload: jsonb('payload').notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
  pushToken: text('push_token').notNull(),
  isTrusted: boolean('is_trusted').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -- F010 — Multi-factor auth (TOTP) ----------------------------------
export const mfaSecrets = pgTable('mfa_secrets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .unique()
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(), // app-encrypted (AES-256-GCM)
  verified: boolean('verified').notNull().default(false),
  recoveryCodes: jsonb('recovery_codes').notNull().default([]), // hashed (PBKDF2)
  lastUsedStep: bigint('last_used_step', { mode: 'number' }), // RFC 6238 replay guard
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -- F011 — Referrals + FELO Plus -------------------------------------
export const referralCodes = pgTable('referral_codes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: uuid('owner_user_id')
    .unique()
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  code: text('code').unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  codeId: uuid('code_id')
    .notNull()
    .references(() => referralCodes.id, { onDelete: 'cascade' }),
  referrerUserId: uuid('referrer_user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  referredUserId: uuid('referred_user_id')
    .unique()
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  status: text('status', {
    enum: ['pending', 'qualified', 'rewarded', 'expired', 'revoked'],
  })
    .notNull()
    .default('pending'),
  rewardMinor: bigint('reward_minor', { mode: 'number' }),
  rewardCurrency: char('reward_currency', { length: 3 }),
  qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
  rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -- F007 — Splits ----------------------------------------------------
export const splits = pgTable(
  'splits',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    notes: text('notes'),
    isSettled: boolean('is_settled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ownerIdx: index('idx_splits_owner').on(t.ownerUserId) }),
);

export const splitParticipants = pgTable(
  'split_participants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    splitId: uuid('split_id')
      .notNull()
      .references(() => splits.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => profiles.id),
    displayName: text('display_name').notNull(),
    shareMinor: bigint('share_minor', { mode: 'number' }).notNull(),
    paid: boolean('paid').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ splitIdx: index('idx_split_participants_split').on(t.splitId) }),
);

// -- F008 — Investments -----------------------------------------------
export const investments = pgTable(
  'investments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    name: text('name'),
    assetClass: text('asset_class', {
      enum: ['equity', 'etf', 'crypto', 'mutual_fund', 'bond', 'real_estate', 'other'],
    })
      .notNull()
      .default('equity'),
    currency: char('currency', { length: 3 }).notNull(),
    units: numeric('units', { precision: 20, scale: 8 }).notNull(),
    costBasisMinor: bigint('cost_basis_minor', { mode: 'number' }).notNull(),
    lastPriceMinor: bigint('last_price_minor', { mode: 'number' }),
    lastPricedAt: timestamp('last_priced_at', { withTimezone: true }),
    notes: text('notes'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('idx_investments_user').on(t.userId) }),
);

// Type exports
export type MfaSecret = typeof mfaSecrets.$inferSelect;
export type ReferralCode = typeof referralCodes.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type Split = typeof splits.$inferSelect;
export type SplitParticipant = typeof splitParticipants.$inferSelect;
export type Investment = typeof investments.$inferSelect;
export type NewInvestment = typeof investments.$inferInsert;

// -- Type exports for repositories --------------------------------------
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type FeloScore = typeof feloScores.$inferSelect;
export type RecurringBill = typeof recurringBills.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type CoachConversation = typeof coachConversations.$inferSelect;
export type CoachQuery = typeof coachQueries.$inferSelect;
export type FamilyGroup = typeof familyGroups.$inferSelect;
export type FamilyMember = typeof familyMembers.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Device = typeof devices.$inferSelect;

// -- F012 — Cash Envelopes (Pakistan cash-heavy tracking) ---------------
export const cashEnvelopes = pgTable(
  'cash_envelopes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('PKR'),
    budgetMinor: bigint('budget_minor', { mode: 'number' }).notNull().default(0),
    spentMinor: bigint('spent_minor', { mode: 'number' }).notNull().default(0),
    period: text('period', { enum: ['weekly', 'monthly'] })
      .notNull()
      .default('monthly'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('idx_cash_env_user').on(t.userId) }),
);

// -- F013 — Remittance Notebook (manual transfer logging) ---------------
export const remittanceNotebookEntries = pgTable(
  'remittance_notebook_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    recipientName: text('recipient_name').notNull(),
    recipientCountry: text('recipient_country').notNull().default('PK'),
    relationship: text('relationship'),
    provider: text('provider').notNull(),
    sourceCurrency: char('source_currency', { length: 3 }).notNull(),
    targetCurrency: char('target_currency', { length: 3 }).notNull().default('PKR'),
    sourceAmountMinor: bigint('source_amount_minor', { mode: 'number' }).notNull(),
    targetAmountMinor: bigint('target_amount_minor', { mode: 'number' }),
    feeMinor: bigint('fee_minor', { mode: 'number' }),
    fxRate: numeric('fx_rate', { precision: 10, scale: 4 }),
    deliveryMethod: text('delivery_method'),
    deliveryTime: text('delivery_time'),
    status: text('status', {
      enum: ['planned', 'sent', 'received', 'cancelled'],
    })
      .notNull()
      .default('planned'),
    plannedDate: date('planned_date'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    confirmationMethod: text('confirmation_method'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_rem_notebook_user').on(t.userId),
    userStatusIdx: index('idx_rem_notebook_status').on(t.userId, t.status),
  }),
);

// -- F014 — Monthly Closes ("Validate My Month" workflow) ---------------
export const monthlyCloses = pgTable(
  'monthly_closes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    status: text('status', { enum: ['open', 'validating', 'locked'] })
      .notNull()
      .default('open'),
    totalIncomeMinor: bigint('total_income_minor', { mode: 'number' }),
    totalExpenseMinor: bigint('total_expense_minor', { mode: 'number' }),
    budgetAdherencePercent: integer('budget_adherence_percent'),
    goalProgressSummary: jsonb('goal_progress_summary').notNull().default({}),
    validationChecklist: jsonb('validation_checklist').notNull().default([]),
    aiSummary: text('ai_summary'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userMonthUnique: uniqueIndex('idx_monthly_close_unique').on(t.userId, t.year, t.month),
    userIdx: index('idx_monthly_close_user').on(t.userId, t.year, t.month),
  }),
);

// -- F015 — User Data Exports (GDPR/portability) ------------------------
export const userExports = pgTable('user_exports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  format: text('format', { enum: ['json', 'csv'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'processing', 'ready', 'expired'],
  })
    .notNull()
    .default('pending'),
  filePath: text('file_path'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// -- F016 — Subscription Usage (quota tracking) -------------------------
export const subscriptionUsage = pgTable(
  'subscription_usage',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    usageDate: date('usage_date').notNull(),
    expenseCount: integer('expense_count').notNull().default(0),
    aiQueryCount: integer('ai_query_count').notNull().default(0),
    receiptOcrCount: integer('receipt_ocr_count').notNull().default(0),
  },
  (t) => ({
    userDateUnique: uniqueIndex('idx_sub_usage_unique').on(t.userId, t.usageDate),
  }),
);

// =====================================================================
// S1 CAPTURE (9 tables)
// =====================================================================

export const smsBankRoutes = pgTable(
  'sms_bank_routes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bankName: text('bank_name').notNull(),
    country: char('country', { length: 2 }).notNull().default('PK'),
    senderPattern: text('sender_pattern').notNull(),
    parserTemplateId: uuid('parser_template_id'),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    countryIdx: index('idx_sms_bank_routes_country').on(t.country),
    activeIdx: index('idx_sms_bank_routes_active').on(t.isActive),
    patternUnique: uniqueIndex('idx_sms_bank_routes_pattern').on(t.country, t.senderPattern),
  }),
);

export const smsParserTemplates = pgTable('sms_parser_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  regexPatterns: jsonb('regex_patterns').notNull().default([]),
  sampleMessages: jsonb('sample_messages').notNull().default([]),
  version: integer('version').notNull().default(1),
  accuracyScore: numeric('accuracy_score', { precision: 5, scale: 2 }),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const smsIngestionLog = pgTable(
  'sms_ingestion_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    rawHash: text('raw_hash').notNull(),
    sender: text('sender').notNull(),
    bodyPreview: text('body_preview').notNull(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    parserVersion: integer('parser_version').notNull().default(1),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    transactionId: uuid('transaction_id'),
    status: text('status', {
      enum: ['pending', 'parsed', 'failed', 'ignored'],
    })
      .notNull()
      .default('pending'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_sms_ingest_user').on(t.userId),
    statusIdx: index('idx_sms_ingest_status').on(t.status),
    createdIdx: index('idx_sms_ingest_created').on(t.createdAt),
    hashIdx: index('idx_sms_ingest_hash').on(t.rawHash),
  }),
);

export const receiptUploads = pgTable(
  'receipt_uploads',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    imageUrl: text('image_url').notNull(),
    ocrProvider: text('ocr_provider').notNull(),
    ocrResponse: jsonb('ocr_response').notNull().default({}),
    status: text('status', {
      enum: ['pending', 'processing', 'parsed', 'failed'],
    })
      .notNull()
      .default('pending'),
    transactionId: uuid('transaction_id'),
    totalMinor: bigint('total_minor', { mode: 'number' }),
    currency: char('currency', { length: 3 }),
    merchant: text('merchant'),
    lineItems: jsonb('line_items').notNull().default([]),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_receipt_user').on(t.userId),
    statusIdx: index('idx_receipt_status').on(t.status),
    createdIdx: index('idx_receipt_created').on(t.createdAt),
  }),
);

export const ocrProviders = pgTable(
  'ocr_providers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    isActive: boolean('is_active').notNull().default(true),
    region: char('region', { length: 2 }).notNull().default('CA'),
    costPerCallMinor: bigint('cost_per_call_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('CAD'),
    dailyQuotaFree: integer('daily_quota_free').notNull().default(5),
    dailyQuotaPlus: integer('daily_quota_plus').notNull().default(50),
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('idx_ocr_providers_active').on(t.isActive),
    regionIdx: index('idx_ocr_providers_region').on(t.region),
  }),
);

export const ocrUsageLog = pgTable(
  'ocr_usage_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    providerCode: text('provider_code').notNull(),
    receiptUploadId: uuid('receipt_upload_id').references(() => receiptUploads.id, {
      onDelete: 'set null',
    }),
    costMinor: bigint('cost_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('CAD'),
    status: text('status', {
      enum: ['success', 'failed', 'refunded'],
    })
      .notNull()
      .default('success'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_ocr_usage_user').on(t.userId),
    providerIdx: index('idx_ocr_usage_provider').on(t.providerCode),
    createdIdx: index('idx_ocr_usage_created').on(t.createdAt),
  }),
);

export const statementImports = pgTable(
  'statement_imports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    fileUrl: text('file_url').notNull(),
    format: text('format', {
      enum: ['csv', 'ofx', 'qif', 'pdf', 'xlsx'],
    }).notNull(),
    status: text('status', {
      enum: ['pending', 'parsing', 'parsed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    rowsTotal: integer('rows_total').notNull().default(0),
    rowsImported: integer('rows_imported').notNull().default(0),
    errors: jsonb('errors').notNull().default([]),
    parsingErrors: jsonb('parsing_errors').notNull().default([]),
    parsedRowsPreview: jsonb('parsed_rows_preview').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_stmt_import_user').on(t.userId),
    statusIdx: index('idx_stmt_import_status').on(t.status),
    createdIdx: index('idx_stmt_import_created').on(t.createdAt),
  }),
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    key: text('key').notNull().unique(),
    labelEn: text('label_en').notNull(),
    labelUr: text('label_ur'),
    parentKey: text('parent_key'),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index('idx_categories_parent').on(t.parentKey),
    activeIdx: index('idx_categories_active').on(t.isActive),
    sortIdx: index('idx_categories_sort').on(t.sortOrder),
  }),
);

export const merchantAliases = pgTable(
  'merchant_aliases',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    alias: text('alias').notNull(),
    canonicalMerchantId: uuid('canonical_merchant_id'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull().default('1.0'),
    source: text('source', {
      enum: ['manual', 'ml', 'imported'],
    })
      .notNull()
      .default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    aliasIdx: index('idx_merchant_alias_alias').on(t.alias),
    canonIdx: index('idx_merchant_alias_canon').on(t.canonicalMerchantId),
    categoryIdx: index('idx_merchant_alias_category').on(t.categoryId),
    uniqueAlias: uniqueIndex('idx_merchant_alias_unique').on(t.alias, t.canonicalMerchantId),
  }),
);

// =====================================================================
// S2 REMITTANCE (6 tables)
// =====================================================================

export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pair: text('pair').notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: index('idx_fx_pair').on(t.pair),
    fetchedIdx: index('idx_fx_fetched').on(t.fetchedAt),
    pairFetchedUnique: uniqueIndex('idx_fx_pair_fetched').on(t.pair, t.fetchedAt),
  }),
);

export const fxOverrides = pgTable(
  'fx_overrides',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pair: text('pair').notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    approvedBy: uuid('approved_by').references(() => profiles.id, { onDelete: 'set null' }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: index('idx_fx_override_pair').on(t.pair),
    effectiveIdx: index('idx_fx_override_effective').on(t.effectiveFrom, t.effectiveTo),
    createdByIdx: index('idx_fx_override_created_by').on(t.createdBy),
  }),
);

export const remittanceProviders = pgTable(
  'remittance_providers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    countryPairs: jsonb('country_pairs').notNull().default([]),
    feeStructure: jsonb('fee_structure').notNull().default({}),
    etaHours: integer('eta_hours'),
    kycRequirements: jsonb('kyc_requirements').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('idx_rem_providers_active').on(t.isActive),
    codeIdx: index('idx_rem_providers_code').on(t.code),
  }),
);

export const remittanceProviderQuotes = pgTable(
  'remittance_provider_quotes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: text('provider').notNull(),
    source: char('source', { length: 3 }).notNull(),
    target: char('target', { length: 3 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    feeMinor: bigint('fee_minor', { mode: 'number' }).notNull().default(0),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    etaHours: integer('eta_hours'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index('idx_rem_quotes_provider').on(t.provider),
    pairIdx: index('idx_rem_quotes_pair').on(t.source, t.target),
    fetchedIdx: index('idx_rem_quotes_fetched').on(t.fetchedAt),
  }),
);

export const complianceThresholds = pgTable(
  'compliance_thresholds',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ruleKey: text('rule_key').notNull().unique(),
    thresholdMinor: bigint('threshold_minor', { mode: 'number' }).notNull(),
    windowDays: integer('window_days').notNull().default(30),
    severity: text('severity', {
      enum: ['low', 'medium', 'high', 'critical'],
    })
      .notNull()
      .default('medium'),
    audience: jsonb('audience').notNull().default({}),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('idx_compliance_threshold_active').on(t.isActive),
  }),
);

export const complianceFlags = pgTable(
  'compliance_flags',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    ruleKey: text('rule_key').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status', {
      enum: ['open', 'under_review', 'cleared', 'escalated', 'dismissed'],
    })
      .notNull()
      .default('open'),
    reviewerId: uuid('reviewer_id').references(() => profiles.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_compliance_user').on(t.userId),
    statusIdx: index('idx_compliance_status').on(t.status),
    ruleIdx: index('idx_compliance_rule').on(t.ruleKey),
    triggeredIdx: index('idx_compliance_triggered').on(t.triggeredAt),
  }),
);

// =====================================================================
// S3 IDENTITY (5 new tables — family_groups/family_members/coach_conversations altered above)
// =====================================================================

export const familyInvitations = pgTable(
  'family_invitations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    groupId: uuid('group_id')
      .notNull()
      .references(() => familyGroups.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    code: text('code').notNull(),
    role: text('role', { enum: ['admin', 'member', 'viewer'] })
      .notNull()
      .default('member'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status', {
      enum: ['pending', 'accepted', 'declined', 'expired'],
    })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupIdx: index('idx_family_invites_group').on(t.groupId),
    emailIdx: index('idx_family_invites_email').on(t.email),
    codeIdx: index('idx_family_invites_code').on(t.code),
    statusIdx: index('idx_family_invites_status').on(t.status),
    expiresIdx: index('idx_family_invites_expires').on(t.expiresAt),
    uniqueInvite: uniqueIndex('idx_family_invites_unique').on(t.groupId, t.email),
  }),
);

export const familyRolePermissions = pgTable(
  'family_role_permissions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    role: text('role', {
      enum: ['admin', 'member', 'viewer', 'owner'],
    }).notNull(),
    resource: text('resource', {
      enum: ['budget', 'transaction', 'goal', 'setting', 'member', 'invite'],
    }).notNull(),
    action: text('action', {
      enum: ['create', 'read', 'update', 'delete', 'manage'],
    }).notNull(),
    allowed: boolean('allowed').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePerm: uniqueIndex('idx_family_role_perms_unique').on(t.role, t.resource, t.action),
    roleIdx: index('idx_family_role_perms_role').on(t.role),
  }),
);

export const kycDocuments = pgTable(
  'kyc_documents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    docType: text('doc_type', {
      enum: ['passport', 'drivers_license', 'national_id', 'utility_bill', 'selfie', 'other'],
    }).notNull(),
    fileUrl: text('file_url').notNull(),
    status: text('status', {
      enum: ['pending', 'under_review', 'approved', 'rejected'],
    })
      .notNull()
      .default('pending'),
    vendorResponse: jsonb('vendor_response').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_kyc_doc_user').on(t.userId),
    statusIdx: index('idx_kyc_doc_status').on(t.status),
    typeIdx: index('idx_kyc_doc_type').on(t.docType),
  }),
);

export const kycDecisions = pgTable(
  'kyc_decisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['approved', 'rejected', 'manual_review'],
    }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    reviewerId: uuid('reviewer_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_kyc_decision_user').on(t.userId),
    reviewerIdx: index('idx_kyc_decision_reviewer').on(t.reviewerId),
    statusIdx: index('idx_kyc_decision_status').on(t.status),
    uniqueDecision: uniqueIndex('idx_kyc_decision_unique').on(t.userId, t.status),
  }),
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorUserId: uuid('actor_user_id').references(() => profiles.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    operation: text('operation', {
      enum: ['create', 'read', 'update', 'delete', 'login', 'logout', 'export'],
    }).notNull(),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('idx_audit_actor').on(t.actorUserId),
    entityIdx: index('idx_audit_entity').on(t.entityType, t.entityId),
    operationIdx: index('idx_audit_operation').on(t.operation),
    createdIdx: index('idx_audit_created').on(t.createdAt),
  }),
);

export const piiAccessLog = pgTable(
  'pii_access_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    fields: jsonb('fields').notNull().default([]),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    adminIdx: index('idx_pii_admin').on(t.adminUserId),
    targetIdx: index('idx_pii_target').on(t.targetUserId),
    createdIdx: index('idx_pii_created').on(t.createdAt),
  }),
);

// =====================================================================
// S4 INTELLIGENCE (12 new tables — coach_conversations altered above)
// =====================================================================

export const feloScoreHistory = pgTable(
  'felo_score_history',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    components: jsonb('components').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    formulaVersion: integer('formula_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_felo_hist_user').on(t.userId),
    computedIdx: index('idx_felo_hist_computed').on(t.computedAt),
    formulaIdx: index('idx_felo_hist_formula').on(t.formulaVersion),
  }),
);

export const feloScoreFormula = pgTable('felo_score_formula', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  version: integer('version').notNull().unique(),
  weights: jsonb('weights').notNull().default({}),
  thresholds: jsonb('thresholds').notNull().default({}),
  rolledOutAt: timestamp('rolled_out_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgetDefaults = pgTable(
  'budget_defaults',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    corridor: text('corridor', {
      enum: ['canada', 'pakistan', 'other'],
    }).notNull(),
    cohort: text('cohort').notNull().default('all'),
    thresholdPct: integer('threshold_pct').notNull().default(80),
    alertChannel: jsonb('alert_channel').notNull().default(['push']),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueDefault: uniqueIndex('idx_budget_defaults_unique').on(t.corridor, t.cohort),
  }),
);

export const goalNudgeTemplates = pgTable('goal_nudge_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull().unique(),
  cadenceDays: integer('cadence_days').notNull().default(7),
  copyKey: text('copy_key').notNull(),
  channel: text('channel', {
    enum: ['push', 'email', 'inapp', 'sms'],
  })
    .notNull()
    .default('push'),
  audience: jsonb('audience').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billDetectionRules = pgTable(
  'bill_detection_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    regex: text('regex').notNull(),
    categoryKey: text('category_key').notNull(),
    recurrenceHint: text('recurrence_hint', {
      enum: ['weekly', 'monthly', 'quarterly', 'yearly'],
    })
      .notNull()
      .default('monthly'),
    version: integer('version').notNull().default(1),
    audience: jsonb('audience').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryIdx: index('idx_bill_detect_category').on(t.categoryKey),
    versionIdx: index('idx_bill_detect_version').on(t.version),
  }),
);

export const coachPromptTemplates = pgTable(
  'coach_prompt_templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    body: text('body').notNull(),
    variables: jsonb('variables').notNull().default([]),
    model: text('model').notNull().default('gpt-4o'),
    status: text('status', {
      enum: ['draft', 'active', 'deprecated'],
    })
      .notNull()
      .default('draft'),
    canaryPct: integer('canary_pct').notNull().default(0),
    audience: jsonb('audience').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('idx_coach_prompt_key').on(t.key),
    statusIdx: index('idx_coach_prompt_status').on(t.status),
    keyVersionUnique: uniqueIndex('idx_coach_prompt_key_version').on(t.key, t.version),
  }),
);

export const coachGuardrailRules = pgTable(
  'coach_guardrail_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    layer: text('layer', {
      enum: ['input', 'retrieval', 'generation', 'output'],
    }).notNull(),
    ruleKey: text('rule_key').notNull().unique(),
    severity: text('severity', {
      enum: ['warn', 'block', 'log_only'],
    })
      .notNull()
      .default('block'),
    action: text('action', {
      enum: ['refuse', 'sanitize', 'flag', 'allow'],
    })
      .notNull()
      .default('refuse'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    layerIdx: index('idx_coach_guard_layer').on(t.layer),
    severityIdx: index('idx_coach_guard_severity').on(t.severity),
  }),
);

export const coachTools = pgTable('coach_tools', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull().unique(),
  dbQuery: text('db_query').notNull(),
  allowedFields: jsonb('allowed_fields').notNull().default([]),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const coachEvalResults = pgTable(
  'coach_eval_results',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    templateVersion: integer('template_version').notNull(),
    evalId: text('eval_id').notNull(),
    score: numeric('score', { precision: 5, scale: 4 }).notNull(),
    passedAt: timestamp('passed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionIdx: index('idx_coach_eval_version').on(t.templateVersion),
    passedIdx: index('idx_coach_eval_passed').on(t.passedAt),
    uniqueEval: uniqueIndex('idx_coach_eval_unique').on(t.templateVersion, t.evalId),
  }),
);

export const reportTemplates = pgTable(
  'report_templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    layout: jsonb('layout').notNull().default({}),
    copyKey: text('copy_key').notNull(),
    locale: text('locale').notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('idx_report_key').on(t.key),
    localeIdx: index('idx_report_locale').on(t.locale),
    uniqueReport: uniqueIndex('idx_report_unique').on(t.key, t.version, t.locale),
  }),
);

export const marketQuotes = pgTable(
  'market_quotes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    symbol: text('symbol').notNull(),
    price: numeric('price', { precision: 20, scale: 10 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('CAD'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    symbolIdx: index('idx_market_symbol').on(t.symbol),
    fetchedIdx: index('idx_market_fetched').on(t.fetchedAt),
    symbolFetchedUnique: uniqueIndex('idx_market_symbol_fetched').on(t.symbol, t.fetchedAt, t.source),
  }),
);

export const portfolioHoldings = pgTable(
  'portfolio_holdings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    quantity: numeric('quantity', { precision: 20, scale: 8 }).notNull(),
    costBasisMinor: bigint('cost_basis_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('CAD'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_portfolio_user').on(t.userId),
    symbolIdx: index('idx_portfolio_symbol').on(t.symbol),
    userSymbolUnique: uniqueIndex('idx_portfolio_user_symbol').on(t.userId, t.symbol),
  }),
);

// =====================================================================
// S5 MONETIZATION (4 tables)
// =====================================================================

export const subscriptionTiers = pgTable('subscription_tiers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull().unique(),
  labelKey: text('label_key').notNull(),
  priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('CAD'),
  entitlements: jsonb('entitlements').notNull().default({}),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const coupons = pgTable('coupons', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  discountType: text('discount_type', {
    enum: ['percentage', 'fixed_amount', 'free_months'],
  }).notNull(),
  discountValue: bigint('discount_value', { mode: 'number' }).notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  audience: jsonb('audience').notNull().default({}),
  usageCount: integer('usage_count').notNull().default(0),
  maxUses: integer('max_uses'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    type: text('type', {
      enum: ['coupon_override', 'refund', 'kyc_fast_track', 'compliance_override', 'pii_access'],
    }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected', 'expired'],
    })
      .notNull()
      .default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    approverId: uuid('approver_id').references(() => profiles.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('idx_approval_status').on(t.status),
    requesterIdx: index('idx_approval_requester').on(t.requestedBy),
    typeIdx: index('idx_approval_type').on(t.type),
    createdIdx: index('idx_approval_created').on(t.createdAt),
  }),
);

export const paywallVariants = pgTable(
  'paywall_variants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    key: text('key').notNull(),
    layout: jsonb('layout').notNull().default({}),
    audience: jsonb('audience').notNull().default({}),
    abSplit: numeric('ab_split', { precision: 4, scale: 3 }).notNull().default('0.5'),
    isActive: boolean('is_active').notNull().default(true),
    impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
    conversions: bigint('conversions', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('idx_paywall_key').on(t.key),
    activeIdx: index('idx_paywall_active').on(t.isActive),
  }),
);

// =====================================================================
// S6 OPS PORTAL (3 tables)
// =====================================================================

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    supabaseId: text('supabase_id').unique(),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    role: text('role', {
      enum: ['super_admin', 'admin', 'analyst', 'support'],
    })
      .notNull()
      .default('analyst'),
    permissions: jsonb('permissions').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    webauthnCredentialId: text('webauthn_credential_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('idx_admin_email').on(t.email),
    roleIdx: index('idx_admin_role').on(t.role),
    activeIdx: index('idx_admin_active').on(t.isActive),
  }),
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_admin_session_user').on(t.adminUserId),
    tokenIdx: index('idx_admin_session_token').on(t.token),
    expiresIdx: index('idx_admin_session_expires').on(t.expiresAt),
  }),
);

export const twoPersonApprovals = pgTable(
  'two_person_approvals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    requestType: text('request_type', {
      enum: ['config_change', 'data_migration', 'bulk_delete', 'rate_override', 'role_change'],
    }).notNull(),
    targetId: text('target_id'),
    proposedChanges: jsonb('proposed_changes').notNull().default({}),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    approverId: uuid('approver_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected', 'expired', 'superseded'],
    })
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index('idx_two_person_type').on(t.requestType),
    statusIdx: index('idx_two_person_status').on(t.status),
    requesterIdx: index('idx_two_person_requester').on(t.requesterId),
    expiresIdx: index('idx_two_person_expires').on(t.expiresAt),
  }),
);

// =====================================================================
// S7 PLATFORM (7 tables)
// =====================================================================

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    key: text('key').notNull().unique(),
    channel: text('channel', {
      enum: ['push', 'email', 'inapp', 'sms'],
    }).notNull(),
    titleEn: text('title_en').notNull(),
    titleUr: text('title_ur'),
    bodyEn: text('body_en').notNull(),
    bodyUr: text('body_ur'),
    variables: jsonb('variables').notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('idx_notif_tmpl_key').on(t.key),
    channelIdx: index('idx_notif_tmpl_channel').on(t.channel),
    activeIdx: index('idx_notif_tmpl_active').on(t.isActive),
  }),
);

export const announcementBanners = pgTable(
  'announcement_banners',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    titleEn: text('title_en').notNull(),
    titleUr: text('title_ur'),
    bodyEn: text('body_en').notNull(),
    bodyUr: text('body_ur'),
    actionUrl: text('action_url'),
    audienceFilter: jsonb('audience_filter').notNull().default({}),
    priority: integer('priority').notNull().default(0),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('idx_announce_active').on(t.isActive),
    priorityIdx: index('idx_announce_priority').on(t.priority),
    scheduleIdx: index('idx_announce_schedule').on(t.startAt, t.endAt),
  }),
);

export const engagementCampaigns = pgTable(
  'engagement_campaigns',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    audienceFilter: jsonb('audience_filter').notNull().default({}),
    templateId: uuid('template_id').references(() => notificationTemplates.id, {
      onDelete: 'set null',
    }),
    scheduleType: text('schedule_type', {
      enum: ['immediate', 'once', 'recurring'],
    })
      .notNull()
      .default('immediate'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    status: text('status', {
      enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'],
    })
      .notNull()
      .default('draft'),
    metrics: jsonb('metrics').notNull().default({}),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('idx_campaign_status').on(t.status),
    scheduledIdx: index('idx_campaign_scheduled').on(t.scheduledAt),
    createdByIdx: index('idx_campaign_created_by').on(t.createdBy),
  }),
);

export const i18nStrings = pgTable('i18n_strings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull().unique(),
  valueEn: text('value_en').notNull(),
  valueUr: text('value_ur'),
  context: text('context'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    key: text('key').notNull().unique(),
    description: text('description'),
    isEnabled: boolean('is_enabled').notNull().default(false),
    targeting: jsonb('targeting').notNull().default({}),
    killSwitch: boolean('kill_switch').notNull().default(false),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('idx_feature_flag_key').on(t.key),
    enabledIdx: index('idx_feature_flag_enabled').on(t.isEnabled),
    killIdx: index('idx_feature_flag_kill').on(t.killSwitch),
  }),
);

export const dataRetentionPolicies = pgTable('data_retention_policies', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  entityType: text('entity_type').notNull().unique(),
  retentionDays: integer('retention_days').notNull(),
  autoDelete: boolean('auto_delete').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const analyticsEventTaxonomy = pgTable(
  'analytics_event_taxonomy',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    eventName: text('event_name').notNull().unique(),
    category: text('category', {
      enum: ['onboarding', 'transaction', 'budget', 'goal', 'coach', 'remittance', 'subscription', 'engagement', 'system'],
    }).notNull(),
    propertiesSchema: jsonb('properties_schema').notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index('idx_analytics_event_name').on(t.eventName),
    categoryIdx: index('idx_analytics_category').on(t.category),
  }),
);


// =====================================================================
// Type exports — S1 CAPTURE
// =====================================================================
export type SmsBankRoute = typeof smsBankRoutes.$inferSelect;
export type SmsParserTemplate = typeof smsParserTemplates.$inferSelect;
export type SmsIngestionLog = typeof smsIngestionLog.$inferSelect;
export type ReceiptUpload = typeof receiptUploads.$inferSelect;
export type OcrProvider = typeof ocrProviders.$inferSelect;
export type OcrUsageLog = typeof ocrUsageLog.$inferSelect;
export type StatementImport = typeof statementImports.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type MerchantAlias = typeof merchantAliases.$inferSelect;

// =====================================================================
// Type exports — S2 REMITTANCE
// =====================================================================
export type FxRate = typeof fxRates.$inferSelect;
export type FxOverride = typeof fxOverrides.$inferSelect;
export type RemittanceProvider = typeof remittanceProviders.$inferSelect;
export type RemittanceProviderQuote = typeof remittanceProviderQuotes.$inferSelect;
export type ComplianceThreshold = typeof complianceThresholds.$inferSelect;
export type ComplianceFlag = typeof complianceFlags.$inferSelect;

// =====================================================================
// Type exports — S3 IDENTITY
// =====================================================================
export type FamilyInvitation = typeof familyInvitations.$inferSelect;
export type FamilyRolePermission = typeof familyRolePermissions.$inferSelect;
export type KycDocument = typeof kycDocuments.$inferSelect;
export type KycDecision = typeof kycDecisions.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type PiiAccessLogEntry = typeof piiAccessLog.$inferSelect;

// =====================================================================
// Type exports — S4 INTELLIGENCE
// =====================================================================
export type FeloScoreHistory = typeof feloScoreHistory.$inferSelect;
export type FeloScoreFormula = typeof feloScoreFormula.$inferSelect;
export type BudgetDefault = typeof budgetDefaults.$inferSelect;
export type GoalNudgeTemplate = typeof goalNudgeTemplates.$inferSelect;
export type BillDetectionRule = typeof billDetectionRules.$inferSelect;
export type CoachPromptTemplate = typeof coachPromptTemplates.$inferSelect;
export type CoachGuardrailRule = typeof coachGuardrailRules.$inferSelect;
export type CoachTool = typeof coachTools.$inferSelect;
export type CoachEvalResult = typeof coachEvalResults.$inferSelect;
export type ReportTemplate = typeof reportTemplates.$inferSelect;
export type MarketQuote = typeof marketQuotes.$inferSelect;
export type PortfolioHolding = typeof portfolioHoldings.$inferSelect;

// =====================================================================
// Type exports — S5 MONETIZATION
// =====================================================================
export type SubscriptionTier = typeof subscriptionTiers.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type PaywallVariant = typeof paywallVariants.$inferSelect;

// =====================================================================
// Type exports — S6 OPS PORTAL
// =====================================================================
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
export type TwoPersonApproval = typeof twoPersonApprovals.$inferSelect;

// =====================================================================
// Type exports — S7 PLATFORM
// =====================================================================
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type AnnouncementBanner = typeof announcementBanners.$inferSelect;
export type EngagementCampaign = typeof engagementCampaigns.$inferSelect;
export type I18nString = typeof i18nStrings.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type DataRetentionPolicy = typeof dataRetentionPolicies.$inferSelect;
export type AnalyticsEventTaxonomy = typeof analyticsEventTaxonomy.$inferSelect;

// =====================================================================
// New* insert types — added to satisfy Kimi-generated services
// =====================================================================
export type AuditLog = AuditLogEntry;
export type NewAuditLog = typeof auditLog.$inferInsert;
export type PiiAccessLog = PiiAccessLogEntry;
export type NewPiiAccessLog = typeof piiAccessLog.$inferInsert;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type NewAdminSession = typeof adminSessions.$inferInsert;
export type NewTwoPersonApproval = typeof twoPersonApprovals.$inferInsert;
export type NewFamilyInvitation = typeof familyInvitations.$inferInsert;
export type NewFamilyRolePermission = typeof familyRolePermissions.$inferInsert;
export type NewKycDocument = typeof kycDocuments.$inferInsert;
export type NewKycDecision = typeof kycDecisions.$inferInsert;
export type NewFeloScoreHistory = typeof feloScoreHistory.$inferInsert;
export type NewFeloScoreFormula = typeof feloScoreFormula.$inferInsert;
export type NewBudgetDefault = typeof budgetDefaults.$inferInsert;
export type NewGoalNudgeTemplate = typeof goalNudgeTemplates.$inferInsert;
export type NewBillDetectionRule = typeof billDetectionRules.$inferInsert;
export type NewCoachPromptTemplate = typeof coachPromptTemplates.$inferInsert;
export type NewCoachGuardrailRule = typeof coachGuardrailRules.$inferInsert;
export type NewCoachTool = typeof coachTools.$inferInsert;
export type NewCoachEvalResult = typeof coachEvalResults.$inferInsert;
export type NewReportTemplate = typeof reportTemplates.$inferInsert;
export type NewMarketQuote = typeof marketQuotes.$inferInsert;
export type NewPortfolioHolding = typeof portfolioHoldings.$inferInsert;
export type NewSubscriptionTier = typeof subscriptionTiers.$inferInsert;
export type NewCoupon = typeof coupons.$inferInsert;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;
export type NewPaywallVariant = typeof paywallVariants.$inferInsert;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;
export type NewAnnouncementBanner = typeof announcementBanners.$inferInsert;
export type NewEngagementCampaign = typeof engagementCampaigns.$inferInsert;
export type NewI18nString = typeof i18nStrings.$inferInsert;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type NewDataRetentionPolicy = typeof dataRetentionPolicies.$inferInsert;
export type NewAnalyticsEventTaxonomy = typeof analyticsEventTaxonomy.$inferInsert;

// Plural alias compatibility shims (some services import plural names)
export const auditLogs = auditLog;
export const piiAccessLogs = piiAccessLog;

// =====================================================================
// Squad 8 Ops Portal cross-cutting tables
// =====================================================================
export const appConfig = pgTable('app_config', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull().unique(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
  description: text('description'),
  audience: jsonb('audience').$type<Record<string, unknown>>().notNull().default({}),
  version: integer('version').notNull().default(1),
  updatedByAdminId: uuid('updated_by_admin_id').references(() => adminUsers.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vendorCredentials = pgTable(
  'vendor_credentials',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    vendorKey: text('vendor_key').notNull(),
    env: text('env', { enum: ['dev', 'staging', 'prod'] }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    setByAdminId: uuid('set_by_admin_id').references(() => adminUsers.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ vendorEnvIdx: uniqueIndex('idx_vendor_env').on(t.vendorKey, t.env) }),
);

export const notificationTriggers = pgTable('notification_triggers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ruleKey: text('rule_key').notNull().unique(),
  conditionDsl: jsonb('condition_dsl').$type<Record<string, unknown>>().notNull().default({}),
  templateKey: text('template_key').notNull(),
  channelPriority: jsonb('channel_priority').$type<unknown[]>().notNull().default([]),
  throttlePerDay: integer('throttle_per_day').notNull().default(1),
  audience: jsonb('audience').$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AppConfig = typeof appConfig.$inferSelect;
export type NewAppConfigRow = typeof appConfig.$inferInsert;
export type VendorCredential = typeof vendorCredentials.$inferSelect;
export type NewVendorCredential = typeof vendorCredentials.$inferInsert;
export type NotificationTrigger = typeof notificationTriggers.$inferSelect;
export type NewNotificationTrigger = typeof notificationTriggers.$inferInsert;

// =====================================================================
// Treasury / Ledger / Disbursement subsystem (Squads 2/3/4)
// Self-contained back-office tables with integer PKs. Distinct from
// the user-facing UUID-based profiles + audit_log model on the rest of
// this schema. SQL-namespaced under treasury_*.
// =====================================================================
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'inactive']);
export const kycTierEnum = pgEnum('kyc_tier', ['none', 'basic', 'verified', 'premium']);
export const auditActionEnum = pgEnum('audit_action', [
  'user_created', 'user_updated', 'user_deleted',
  'kyc_submitted', 'kyc_approved', 'kyc_rejected',
  'transaction_created', 'transaction_updated', 'transaction_deleted',
  'ledger_entry_created', 'ledger_entry_reversed',
  'deal_booked', 'deal_settled', 'deal_cancelled',
  'disbursement_created', 'disbursement_sent', 'disbursement_received',
  'disbursement_cancelled', 'disbursement_retried', 'disbursement_failed',
]);
export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', ['asset', 'liability', 'equity', 'income', 'expense']);
export const ledgerNormalSideEnum = pgEnum('ledger_normal_side', ['debit', 'credit']);
export const dealStatusEnum = pgEnum('deal_status', ['draft', 'booked', 'settled', 'cancelled']);
export const disbursementMethodTypeEnum = pgEnum('disbursement_method_type', ['wallet', 'bank', 'cash_otc']);
export const disbursementOrderStatusEnum = pgEnum('disbursement_order_status', ['pending', 'sent', 'received', 'cancelled', 'failed']);

export const treasuryActors = pgTable(
  'treasury_actors',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }),
    status: userStatusEnum('status').notNull().default('active'),
    kycTier: kycTierEnum('kyc_tier').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex('treasury_actors_email_idx').on(table.email),
  }),
);

export const treasuryAuditLogs = pgTable(
  'treasury_audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => treasuryActors.id),
    action: auditActionEnum('action').notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: integer('entity_id'),
    payload: jsonb('payload'),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actorIdx: index('treasury_audit_logs_actor_id_idx').on(table.actorId),
    actionIdx: index('treasury_audit_logs_action_idx').on(table.action),
    entityIdx: index('treasury_audit_logs_entity_idx').on(table.entityType, table.entityId),
    createdAtIdx: index('treasury_audit_logs_created_at_idx').on(table.createdAt),
  }),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ledgerAccounts: any = pgTable(
  'ledger_accounts',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').notNull().references(() => treasuryActors.id),
    type: ledgerAccountTypeEnum('type').notNull(),
    normalSide: ledgerNormalSideEnum('normal_side').notNull(),
    parentId: integer('parent_id'),
    currency: varchar('currency', { length: 3 }).notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'bigint' }).notNull().default(0n),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actorIdx: index('ledger_accounts_actor_id_idx').on(table.actorId),
    typeIdx: index('ledger_accounts_type_idx').on(table.type),
    currencyIdx: index('ledger_accounts_currency_idx').on(table.currency),
  }),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ledgerEntries: any = pgTable(
  'ledger_entries',
  {
    id: serial('id').primaryKey(),
    transactionId: varchar('transaction_id', { length: 64 }).notNull(),
    ledgerAccountId: integer('ledger_account_id').notNull(),
    debitMinor: bigint('debit_minor', { mode: 'bigint' }).notNull().default(0n),
    creditMinor: bigint('credit_minor', { mode: 'bigint' }).notNull().default(0n),
    currency: varchar('currency', { length: 3 }).notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).defaultNow().notNull(),
    reversalOf: integer('reversal_of'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    txnIdx: index('ledger_entries_transaction_id_idx').on(table.transactionId),
    accountIdx: index('ledger_entries_ledger_account_id_idx').on(table.ledgerAccountId),
    postedAtIdx: index('ledger_entries_posted_at_idx').on(table.postedAt),
    reversalIdx: index('ledger_entries_reversal_of_idx').on(table.reversalOf),
  }),
);

export const treasuryAccounts = pgTable(
  'treasury_accounts',
  {
    id: serial('id').primaryKey(),
    currency: varchar('currency', { length: 3 }).notNull().unique(),
    balanceMinor: bigint('balance_minor', { mode: 'bigint' }).notNull().default(0n),
    bankName: varchar('bank_name', { length: 255 }),
    accountNoMasked: varchar('account_no_masked', { length: 64 }),
    country: varchar('country', { length: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export const deals = pgTable(
  'deals',
  {
    id: serial('id').primaryKey(),
    sourceCurrency: varchar('source_currency', { length: 3 }).notNull(),
    targetCurrency: varchar('target_currency', { length: 3 }).notNull(),
    sourceAmountMinor: bigint('source_amount_minor', { mode: 'bigint' }).notNull(),
    targetAmountMinor: bigint('target_amount_minor', { mode: 'bigint' }).notNull(),
    ourRate: numeric('our_rate', { precision: 18, scale: 8 }).notNull(),
    marketRate: numeric('market_rate', { precision: 18, scale: 8 }).notNull(),
    marginBps: integer('margin_bps').notNull(),
    status: dealStatusEnum('status').notNull().default('draft'),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('deals_status_idx').on(table.status),
    currenciesIdx: index('deals_currencies_idx').on(table.sourceCurrency, table.targetCurrency),
  }),
);

export const disbursementMethods = pgTable(
  'disbursement_methods',
  {
    id: serial('id').primaryKey(),
    type: disbursementMethodTypeEnum('type').notNull(),
    provider: varchar('provider', { length: 128 }).notNull(),
    country: varchar('country', { length: 2 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    supportsCurrencies: jsonb('supports_currencies').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    typeCountryIdx: index('disbursement_methods_type_country_idx').on(table.type, table.country),
  }),
);

export const disbursementOrders = pgTable(
  'disbursement_orders',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').notNull().references(() => treasuryActors.id),
    dealId: integer('deal_id').references(() => deals.id),
    methodId: integer('method_id').notNull().references(() => disbursementMethods.id),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: disbursementOrderStatusEnum('status').notNull().default('pending'),
    providerRef: varchar('provider_ref', { length: 255 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actorIdx: index('disbursement_orders_actor_id_idx').on(table.actorId),
    dealIdx: index('disbursement_orders_deal_id_idx').on(table.dealId),
    statusIdx: index('disbursement_orders_status_idx').on(table.status),
  }),
);

export const kycProfiles = pgTable(
  'kyc_profiles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' })
      .unique(),
    fullName: text('full_name').notNull(),
    dob: date('dob').notNull(),
    nationality: text('nationality').notNull(),
    address: text('address').notNull(),
    status: text('status', {
      enum: ['pending', 'in_review', 'approved', 'rejected', 'needs_info'],
    })
      .notNull()
      .default('pending'),
    reviewerId: uuid('reviewer_id').references(() => profiles.id, { onDelete: 'set null' }),
    notes: text('notes'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_kyc_profile_user').on(t.userId),
    statusIdx: index('idx_kyc_profile_status').on(t.status),
    reviewerIdx: index('idx_kyc_profile_reviewer').on(t.reviewerId),
  }),
);

export const kycProfileDocuments = pgTable(
  'kyc_profile_documents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => kycProfiles.id, { onDelete: 'cascade' }),
    docType: text('doc_type', {
      enum: ['passport', 'id_card', 'proof_of_address', 'selfie', 'other'],
    }).notNull(),
    fileUrl: text('file_url').notNull(),
    fileKey: text('file_key').notNull(),
    status: text('status', {
      enum: ['pending', 'verified', 'rejected'],
    })
      .notNull()
      .default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    reviewerNotes: text('reviewer_notes'),
  },
  (t) => ({
    profileIdx: index('idx_kyc_profile_doc_profile').on(t.profileId),
    typeIdx: index('idx_kyc_profile_doc_type').on(t.docType),
    statusIdx: index('idx_kyc_profile_doc_status').on(t.status),
  }),
);

export const kybBusinesses = pgTable(
  'kyb_businesses',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessName: text('business_name').notNull(),
    registrationNumber: text('registration_number').notNull(),
    country: text('country').notNull(),
    businessType: text('business_type').notNull(),
    tradeLicense: text('trade_license'),
    incorporationDate: date('incorporation_date'),
    address: text('address').notNull(),
    website: text('website'),
    status: text('status', {
      enum: ['pending', 'in_review', 'approved', 'rejected', 'needs_info'],
    })
      .notNull()
      .default('pending'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    regIdx: index('idx_kyb_business_reg').on(t.registrationNumber),
    countryIdx: index('idx_kyb_business_country').on(t.country),
    statusIdx: index('idx_kyb_business_status').on(t.status),
  }),
);

export const kybUbos = pgTable(
  'kyb_ubos',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => kybBusinesses.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    dob: date('dob'),
    nationality: text('nationality'),
    ownershipPercentage: numeric('ownership_percentage', { precision: 5, scale: 2 }).notNull(),
    kycProfileId: uuid('kyc_profile_id').references(() => kycProfiles.id, { onDelete: 'set null' }),
    status: text('status', {
      enum: ['pending', 'verified', 'rejected'],
    })
      .notNull()
      .default('pending'),
  },
  (t) => ({
    businessIdx: index('idx_kyb_ubo_business').on(t.businessId),
    kycIdx: index('idx_kyb_ubo_kyc').on(t.kycProfileId),
  }),
);

export const kybBusinessDocuments = pgTable(
  'kyb_business_documents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => kybBusinesses.id, { onDelete: 'cascade' }),
    docType: text('doc_type', {
      enum: ['trade_license', 'certificate_of_incorporation', 'bank_statement', 'financial_statement', 'other'],
    }).notNull(),
    fileUrl: text('file_url').notNull(),
    fileKey: text('file_key').notNull(),
    status: text('status', {
      enum: ['pending', 'verified', 'rejected'],
    })
      .notNull()
      .default('pending'),
  },
  (t) => ({
    businessIdx: index('idx_kyb_business_doc_business').on(t.businessId),
    typeIdx: index('idx_kyb_business_doc_type').on(t.docType),
  }),
);

export const tmsRules = pgTable(
  'tms_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['velocity', 'threshold', 'pattern', 'geographic', 'new_user', 'sanctions'],
    }).notNull(),
    config: jsonb('config').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index('idx_tms_rule_type').on(t.type),
    activeIdx: index('idx_tms_rule_active').on(t.isActive),
  }),
);

export const tmsAlerts = pgTable(
  'tms_alerts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => tmsRules.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id').notNull(),
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
    riskScore: integer('risk_score').notNull().default(0),
    status: text('status', {
      enum: ['open', 'under_review', 'confirmed', 'false_positive'],
    })
      .notNull()
      .default('open'),
    assignedTo: uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    ruleIdx: index('idx_tms_alert_rule').on(t.ruleId),
    txnIdx: index('idx_tms_alert_txn').on(t.transactionId),
    userIdx: index('idx_tms_alert_user').on(t.userId),
    statusIdx: index('idx_tms_alert_status').on(t.status),
  }),
);

export const tmsCases = pgTable(
  'tms_cases',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    caseNumber: text('case_number').notNull().unique(),
    status: text('status', {
      enum: ['open', 'in_progress', 'closed'],
    })
      .notNull()
      .default('open'),
    priority: text('priority', {
      enum: ['low', 'medium', 'high', 'critical'],
    })
      .notNull()
      .default('medium'),
    assignedTo: uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
    notes: text('notes'),
    linkedAlertIds: jsonb('linked_alert_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    numberIdx: index('idx_tms_case_number').on(t.caseNumber),
    statusIdx: index('idx_tms_case_status').on(t.status),
    assignedIdx: index('idx_tms_case_assigned').on(t.assignedTo),
  }),
);

export const tmsSanctions = pgTable(
  'tms_sanctions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    listType: text('list_type', {
      enum: ['ofac', 'un', 'eu', 'hmt'],
    }).notNull(),
    entityName: text('entity_name').notNull(),
    aliases: jsonb('aliases').notNull().default([]),
    program: text('program'),
    riskLevel: text('risk_level', {
      enum: ['low', 'medium', 'high', 'critical'],
    }).notNull().default('medium'),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listIdx: index('idx_tms_sanction_list').on(t.listType),
    entityIdx: index('idx_tms_sanction_entity').on(t.entityName),
  }),
);

export const complianceConfig = pgTable(
  'compliance_config',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    section: text('section', {
      enum: ['kyc', 'kyb', 'tms'],
    }).notNull(),
    config: jsonb('config').notNull(),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sectionIdx: uniqueIndex('idx_compliance_config_section').on(t.section),
  }),
);

export type KycProfile = typeof kycProfiles.$inferSelect;
export type NewKycProfile = typeof kycProfiles.$inferInsert;
export type KycProfileDocument = typeof kycProfileDocuments.$inferSelect;
export type NewKycProfileDocument = typeof kycProfileDocuments.$inferInsert;
export type KybBusiness = typeof kybBusinesses.$inferSelect;
export type NewKybBusiness = typeof kybBusinesses.$inferInsert;
export type KybUbo = typeof kybUbos.$inferSelect;
export type NewKybUbo = typeof kybUbos.$inferInsert;
export type KybBusinessDocument = typeof kybBusinessDocuments.$inferSelect;
export type NewKybBusinessDocument = typeof kybBusinessDocuments.$inferInsert;
export type TmsRule = typeof tmsRules.$inferSelect;
export type NewTmsRule = typeof tmsRules.$inferInsert;
export type TmsAlert = typeof tmsAlerts.$inferSelect;
export type NewTmsAlert = typeof tmsAlerts.$inferInsert;
export type TmsCase = typeof tmsCases.$inferSelect;
export type NewTmsCase = typeof tmsCases.$inferInsert;
export type TmsSanction = typeof tmsSanctions.$inferSelect;
export type NewTmsSanction = typeof tmsSanctions.$inferInsert;
export type ComplianceConfigRow = typeof complianceConfig.$inferSelect;
export type NewComplianceConfig = typeof complianceConfig.$inferInsert;

export type NewTreasuryActor = typeof treasuryActors.$inferInsert;
export type TreasuryAuditLog = typeof treasuryAuditLogs.$inferSelect;
export type NewTreasuryAuditLog = typeof treasuryAuditLogs.$inferInsert;
export type TreasuryAccount = typeof treasuryAccounts.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type DisbursementMethod = typeof disbursementMethods.$inferSelect;
export type DisbursementOrder = typeof disbursementOrders.$inferSelect;
export type NewDisbursementOrder = typeof disbursementOrders.$inferInsert;
