import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, desc, sql, gte, like, or } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  profiles,
  transactions,
  accounts,
  subscriptions,
  auditLogs,
  piiAccessLogs,
} from '@db/schema';

@Injectable()
export class TraceabilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Build a timeline of all activity for a user. */
  async getUserTimeline(userId: string) {
    // Verify user exists
    const profile = await this.db.query.profiles.findFirst({
      where: eq(profiles.id, userId),
    });
    if (!profile) throw new NotFoundException('User not found');

    // Get all transactions
    const txns = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(100);

    // Get accounts
    const accts = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .orderBy(desc(accounts.createdAt));

    // Get subscription history
    const subs = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt));

    // Get audit events
    const audits = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50);

    // Get PII access logs
    const piiAccesses = await this.db
      .select()
      .from(piiAccessLogs)
      .where(eq(piiAccessLogs.targetUserId, userId))
      .orderBy(desc(piiAccessLogs.createdAt))
      .limit(50);

    const timeline = [
      { type: 'profile', event: 'created', date: profile.createdAt, data: profile },
      ...txns.map((t) => ({ type: 'transaction' as const, event: `${t.direction}_${t.source}` as string, date: t.createdAt, data: t })),
      ...accts.map((a) => ({ type: 'account' as const, event: 'linked', date: a.createdAt, data: a })),
      ...subs.map((s) => ({ type: 'subscription' as const, event: s.status, date: s.createdAt, data: s })),
      ...audits.map((a) => ({ type: 'audit' as const, event: a.action, date: a.createdAt, data: a })),
      ...piiAccesses.map((p) => ({ type: 'pii_access' as const, event: 'pii_viewed', date: p.createdAt, data: p })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      userId,
      profile,
      timeline,
    };
  }

  /** Get transaction lineage — all related records. */
  async getTransactionLineage(transactionId: string) {
    const txn = await this.db.query.transactions.findFirst({
      where: eq(transactions.id, transactionId),
    });
    if (!txn) throw new NotFoundException('Transaction not found');

    // Get related audit logs
    const audits = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, transactionId))
      .orderBy(desc(auditLogs.createdAt));

    // Get user profile at time of transaction
    const profile = await this.db.query.profiles.findFirst({
      where: eq(profiles.id, txn.userId),
    });

    return {
      transaction: txn,
      user: profile,
      auditTrail: audits,
      lineage: [
        { type: 'user', id: txn.userId, relation: 'owner' },
        ...(txn.accountId ? [{ type: 'account' as const, id: txn.accountId, relation: 'source_account' as const }] : []),
      ],
    };
  }

  /** Search across users, transactions, and audit logs. */
  async search(query: string, limit = 20) {
    const likeQuery = `%${query}%`;

    const users = await this.db
      .select()
      .from(profiles)
      .where(
        or(
          like(profiles.email, likeQuery),
          like(profiles.displayName, likeQuery),
          like(profiles.phoneE164, likeQuery),
        ),
      )
      .limit(limit);

    const txns = await this.db
      .select()
      .from(transactions)
      .where(
        or(
          like(transactions.merchant, likeQuery),
          like(transactions.category, likeQuery),
        ),
      )
      .limit(limit);

    return { users, transactions: txns };
  }
}
