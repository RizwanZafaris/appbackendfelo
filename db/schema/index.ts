/**
 * Felo — canonical database schema.
 *
 * Mirrors the SQL DDL in `db/supabase/000_init.sql` exactly. Drizzle is the
 * source of truth for typed queries; the SQL file is the source of truth for
 * Supabase RLS policies (which Drizzle does not yet model natively).
 *
 * When you add a column or table here:
 *   1. Update `db/supabase/000_init.sql` (or write a new migration file).
 *   2. Run `npm run db:generate` to emit a Drizzle migration.
 *   3. Apply via `npm run db:migrate` (local) or push the SQL to Supabase.
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

// -- USERS --------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    firebaseUid: text('firebase_uid').notNull().unique(),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    phoneE164: text('phone_e164'),
    corridor: text('corridor', { enum: ['canada', 'pakistan', 'other'] }).notNull(),
    languageCode: text('language_code').notNull().default('en'),
    kycStatus: text('kyc_status', {
      enum: ['not_started', 'in_progress', 'submitted', 'approved', 'rejected'],
    })
      .notNull()
      .default('not_started'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    firebaseUidIdx: uniqueIndex('idx_users_firebase_uid').on(t.firebaseUid),
  }),
);

// -- ACCOUNTS -----------------------------------------------------------
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'td' | 'rbc' | 'easypaisa' | 'jazzcash' | 'manual'
    displayName: text('display_name'),
    currency: char('currency', { length: 3 }).notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'number' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
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
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id),
    merchant: text('merchant'),
    category: text('category'),
    currency: char('currency', { length: 3 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    direction: text('direction', { enum: ['debit', 'credit'] }).notNull(),
    source: text('source', {
      enum: ['sms', 'manual', 'bank_alert', 'ocr', 'import'],
    }).notNull(),
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
      .references(() => users.id, { onDelete: 'cascade' }),
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
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    targetMinor: bigint('target_minor', { mode: 'number' }).notNull(),
    savedMinor: bigint('saved_minor', { mode: 'number' }).notNull().default(0),
    targetDate: date('target_date'),
    cadence: text('cadence', { enum: ['weekly', 'monthly', 'manual'] }).notNull(),
    shared: boolean('shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_goals_user').on(t.userId),
  }),
);

// -- FAMILY -------------------------------------------------------------
export const familyGroups = pgTable('family_groups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
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
      .references(() => users.id),
    role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull(),
    canViewSharedTransactions: boolean('can_view_shared_transactions')
      .notNull()
      .default(false),
    canEditSharedBudgets: boolean('can_edit_shared_budgets').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyUserUnique: uniqueIndex('idx_family_members_unique').on(t.familyId, t.userId),
  }),
);

// -- CONSENT LEDGER (audit) ---------------------------------------------
export const consentEvents = pgTable('consent_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: uuid('actor_user_id').notNull(),
  subjectUserId: uuid('subject_user_id').notNull(),
  resourceType: text('resource_type'),
  resourceId: uuid('resource_id'),
  action: text('action'), // 'viewed' | 'edited' | 'shared' | 'revoked'
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').notNull().default({}),
});

// -- NOTIFICATIONS ------------------------------------------------------
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: ['push', 'email', 'inapp', 'sms'] }).notNull(),
  type: text('type').notNull(), // 'budget_alert' | 'goal_milestone' | 'family_invite' | 'system'
  title: text('title').notNull(),
  body: text('body'),
  payload: jsonb('payload').notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -- DEVICES (push) -----------------------------------------------------
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
  pushToken: text('push_token').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Convenience type exports for repositories.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type FamilyGroup = typeof familyGroups.$inferSelect;
export type FamilyMember = typeof familyMembers.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Device = typeof devices.$inferSelect;
