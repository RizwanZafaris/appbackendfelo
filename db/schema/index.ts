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
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
    messages: jsonb('messages').notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUpdatedIdx: index('idx_coach_conv_user').on(t.userId, t.updatedAt),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    familyId: uuid('family_id')
      .notNull()
      .references(() => familyGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id),
    role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull(),
    canViewSharedTransactions: boolean('can_view_shared_transactions')
      .notNull()
      .default(false),
    canEditSharedBudgets: boolean('can_edit_shared_budgets').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyUserUnique: uniqueIndex('idx_family_members_unique').on(t.familyId, t.userId),
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
