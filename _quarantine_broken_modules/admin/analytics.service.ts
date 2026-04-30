import { Injectable, Inject } from '@nestjs/common';
import { sql, eq, gte, and, count, desc } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { profiles, transactions, subscriptions } from '@db/schema';

@Injectable()
export class AdminAnalyticsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Get cohort retention curves. */
  async getCohorts() {
    const cohorts = await this.db.execute(sql`
      WITH cohorts AS (
        SELECT
          DATE_TRUNC('week', created_at) AS cohort_week,
          id AS user_id
        FROM profiles
        WHERE created_at >= NOW() - INTERVAL '12 weeks'
      ),
      activity AS (
        SELECT DISTINCT
          DATE_TRUNC('week', booked_at) AS activity_week,
          user_id
        FROM transactions
        WHERE booked_at >= NOW() - INTERVAL '12 weeks'
      )
      SELECT
        c.cohort_week,
        COUNT(DISTINCT c.user_id) AS cohort_size,
        FLOOR(EXTRACT(EPOCH FROM (a.activity_week - c.cohort_week)) / (7 * 86400)) AS week_number,
        COUNT(DISTINCT a.user_id) AS active_users
      FROM cohorts c
      LEFT JOIN activity a ON c.user_id = a.user_id
      GROUP BY c.cohort_week, week_number
      ORDER BY c.cohort_week, week_number
    `);

    return cohorts.rows ?? [];
  }

  /** Get 5-stage signup funnel. */
  async getFunnel() {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const totalSignups = await this.db
      .select({ count: count() })
      .from(profiles)
      .where(gte(profiles.createdAt, monthAgo));

    const completedOnboarding = await this.db
      .select({ count: count() })
      .from(profiles)
      .where(and(gte(profiles.createdAt, monthAgo), eq(profiles.onboardingComplete, true)));

    const linkedAccount = await this.db.execute(sql`
      SELECT COUNT(DISTINCT user_id) as count
      FROM accounts
      WHERE created_at >= ${monthAgo}
    `);

    const firstTransaction = await this.db.execute(sql`
      SELECT COUNT(DISTINCT user_id) as count
      FROM transactions
      WHERE booked_at >= ${monthAgo}
    `);

    const subscribed = await this.db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          gte(subscriptions.createdAt, monthAgo),
          eq(subscriptions.status, 'active'),
        ),
      );

    return {
      period: 'last_30_days',
      stages: [
        { name: 'signup', count: totalSignups[0]?.count ?? 0 },
        { name: 'onboarding_complete', count: completedOnboarding[0]?.count ?? 0 },
        { name: 'account_linked', count: Number((linkedAccount.rows?.[0] as Record<string, unknown>)?.count ?? 0) },
        { name: 'first_transaction', count: Number((firstTransaction.rows?.[0] as Record<string, unknown>)?.count ?? 0) },
        { name: 'subscribed', count: subscribed[0]?.count ?? 0 },
      ],
    };
  }

  /** Get MRR waterfall — new, churned, net. */
  async getMrr() {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // New MRR — subscriptions created in last 30d that are active
    const newMrr = await this.db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          gte(subscriptions.createdAt, monthAgo),
          eq(subscriptions.status, 'active'),
        ),
      );

    // Churned — were active 30-60d ago but not now
    const churned = await this.db.execute(sql`
      SELECT COUNT(*) as count
      FROM subscriptions
      WHERE status != 'active'
        AND created_at >= ${twoMonthsAgo}
        AND created_at < ${monthAgo}
    `);

    // Total active
    const totalActive = await this.db
      .select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'));

    return {
      newMrr: (newMrr[0]?.count ?? 0) * 500, // Rs. 500 per sub
      churnedMrr: Number((churned.rows?.[0] as Record<string, unknown>)?.count ?? 0) * 500,
      totalActiveMrr: (totalActive[0]?.count ?? 0) * 500,
      period: 'last_30_days',
    };
  }

  /** Get lifetime value estimates. */
  async getLtv() {
    const userLifetimes = await this.db.execute(sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM (COALESCE(s.expires_at, NOW()) - s.created_at)) / 86400) AS avg_lifetime_days,
        COUNT(*) AS total_subs
      FROM subscriptions s
      WHERE s.status IN ('active', 'canceled')
    `);

    const avgLifetimeDays = Number((userLifetimes.rows?.[0] as Record<string, unknown>)?.avg_lifetime_days ?? 0);
    const totalSubs = Number((userLifetimes.rows?.[0] as Record<string, unknown>)?.total_subs ?? 0);

    // LTV = avg lifetime months * monthly price
    const monthlyPrice = 500;
    const avgLifetimeMonths = avgLifetimeDays / 30;
    const ltv = Math.floor(avgLifetimeMonths * monthlyPrice);

    return {
      avgLifetimeDays: Math.floor(avgLifetimeDays),
      avgLifetimeMonths: Math.floor(avgLifetimeMonths),
      ltvMinor: ltv * 100,
      ltvPkr: ltv,
      totalSubscriptionsAnalyzed: totalSubs,
    };
  }

  /** Generate CSV export of key metrics. */
  async exportCsv(): Promise<string> {
    const header = 'metric,value,period\n';

    const stats = await this.getMrr();
    const ltv = await this.getLtv();
    const funnel = await this.getFunnel();

    const rows = [
      `new_mrr_pkr,${stats.newMrr},last_30_days`,
      `churned_mrr_pkr,${stats.churnedMrr},last_30_days`,
      `total_active_mrr_pkr,${stats.totalActiveMrr},current`,
      `ltv_pkr,${ltv.ltvPkr},all_time`,
      `avg_lifetime_days,${ltv.avgLifetimeDays},all_time`,
      ...funnel.stages.map((s) => `funnel_${s.name},${s.count},last_30_days`),
    ];

    return header + rows.join('\n');
  }
}
