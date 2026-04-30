import { Injectable, Inject } from '@nestjs/common';
import { sql, eq, gte, and, count, sum, avg } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  profiles,
  transactions,
  subscriptions,
  accounts,
} from '@db/schema';

@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Get dashboard stats: DAU/MAU, MRR, ARPU. */
  async getStats() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // DAU — profiles updated in last 24h (proxy for active)
    const dauResult = await this.db
      .select({ count: count() })
      .from(profiles)
      .where(gte(profiles.updatedAt, dayAgo));

    // MAU — profiles updated in last 30d
    const mauResult = await this.db
      .select({ count: count() })
      .from(profiles)
      .where(gte(profiles.updatedAt, monthAgo));

    // Total users
    const totalResult = await this.db
      .select({ count: count() })
      .from(profiles);

    // Active subscriptions (MRR proxy)
    const activeSubsResult = await this.db
      .select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'));

    // MRR estimate — active subs * average plan price
    const mrrResult = await this.db
      .select({
        total: sum(sql`COALESCE((metadata->>'price_minor')::bigint, 50000)`),
        count: count(),
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'));

    const dau = dauResult[0]?.count ?? 0;
    const mau = mauResult[0]?.count ?? 0;
    const totalUsers = totalResult[0]?.count ?? 0;
    const activeSubs = activeSubsResult[0]?.count ?? 0;
    const mrrMinor = Number(mrrResult[0]?.total ?? 0);
    const arpuMinor = totalUsers > 0 ? Math.floor(mrrMinor / totalUsers) : 0;

    return {
      dau,
      mau,
      totalUsers,
      activeSubscriptions: activeSubs,
      mrrMinor,
      arpuMinor,
      conversionRate: mau > 0 ? (activeSubs / mau) * 100 : 0,
    };
  }

  /** Get signup funnel: visit -> install -> register -> active -> paid. */
  async getFunnel() {
    const totalUsers = await this.db.select({ count: count() }).from(profiles);
    const onboarded = await this.db
      .select({ count: count() })
      .from(profiles)
      .where(eq(profiles.onboardingComplete, true));
    const withAccounts = await this.db
      .select({ count: sql<number>`COUNT(DISTINCT ${accounts.userId})` })
      .from(accounts);
    const withTransactions = await this.db
      .select({ count: sql<number>`COUNT(DISTINCT ${transactions.userId})` })
      .from(transactions);
    const paidUsers = await this.db
      .select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'));

    const total = totalUsers[0]?.count ?? 1; // avoid div by 0

    return {
      stages: [
        { name: 'registered', count: total },
        { name: 'onboarded', count: onboarded[0]?.count ?? 0 },
        { name: 'linked_account', count: Number(withAccounts[0]?.count ?? 0) },
        { name: 'active_transactor', count: Number(withTransactions[0]?.count ?? 0) },
        { name: 'paid_subscriber', count: paidUsers[0]?.count ?? 0 },
      ],
      conversionRates: [
        { from: 'registered', to: 'onboarded', rate: ((onboarded[0]?.count ?? 0) / total) * 100 },
        { from: 'onboarded', to: 'linked_account', rate: ((onboarded[0]?.count ?? 0) > 0 ? (Number(withAccounts[0]?.count ?? 0) / (onboarded[0]?.count ?? 0)) * 100 : 0) },
        { from: 'linked_account', to: 'active_transactor', rate: ((Number(withAccounts[0]?.count ?? 0)) > 0 ? (Number(withTransactions[0]?.count ?? 0) / Number(withAccounts[0]?.count ?? 0)) * 100 : 0) },
        { from: 'active_transactor', to: 'paid_subscriber', rate: ((Number(withTransactions[0]?.count ?? 0)) > 0 ? ((paidUsers[0]?.count ?? 0) / Number(withTransactions[0]?.count ?? 0)) * 100 : 0) },
      ],
    };
  }

  /** Get transactions grouped by source. */
  async getSources() {
    const results = await this.db
      .select({
        source: transactions.source,
        count: count(),
        totalMinor: sum(transactions.amountMinor),
      })
      .from(transactions)
      .groupBy(transactions.source);

    return results;
  }
}
