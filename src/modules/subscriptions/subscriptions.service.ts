import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  coupons,
  goals,
  paywallVariants,
  profiles,
  subscriptions,
  subscriptionTiers,
  subscriptionUsage,
} from '@db/schema';

export interface TierLimits {
  maxExpensesPerMonth: number;
  maxGoals: number;
  maxGroups: number;
  maxAiQueriesPerMonth: number;
  receiptOcrPerMonth: number;
  hasWeeklyReport: boolean;
  hasMonthlyReport: boolean;
  hasCashEnvelopes: boolean;
  hasExport: boolean;
  hasAdvancedInsights: boolean;
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    maxExpensesPerMonth: 50,
    maxGoals: 1,
    maxGroups: 1,
    maxAiQueriesPerMonth: 10,
    receiptOcrPerMonth: 0,
    hasWeeklyReport: true,
    hasMonthlyReport: false,
    hasCashEnvelopes: false,
    hasExport: false,
    hasAdvancedInsights: false,
  },
  plus: {
    maxExpensesPerMonth: Infinity,
    maxGoals: 5,
    maxGroups: 3,
    maxAiQueriesPerMonth: 100,
    receiptOcrPerMonth: 20,
    hasWeeklyReport: true,
    hasMonthlyReport: true,
    hasCashEnvelopes: true,
    hasExport: true,
    hasAdvancedInsights: true,
  },
  'plus-plus': {
    maxExpensesPerMonth: Infinity,
    maxGoals: Infinity,
    maxGroups: Infinity,
    maxAiQueriesPerMonth: Infinity,
    receiptOcrPerMonth: 100,
    hasWeeklyReport: true,
    hasMonthlyReport: true,
    hasCashEnvelopes: true,
    hasExport: true,
    hasAdvancedInsights: true,
  },
  'founding-family': {
    maxExpensesPerMonth: Infinity,
    maxGoals: Infinity,
    maxGroups: Infinity,
    maxAiQueriesPerMonth: Infinity,
    receiptOcrPerMonth: 100,
    hasWeeklyReport: true,
    hasMonthlyReport: true,
    hasCashEnvelopes: true,
    hasExport: true,
    hasAdvancedInsights: true,
  },
}

export interface UsageSnapshot {
  expensesThisMonth: number;
  goalsActive: number;
  groupsActive: number;
  aiQueriesThisMonth: number;
  receiptOcrThisMonth: number;
}

@Injectable()
export class SubscriptionsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async getUserTier(userId: string): Promise<string> {
    const profile = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return profile[0]?.subscriptionTier || 'free';
  }

  async getTierLimits(userId: string): Promise<TierLimits> {
    const tier = await this.getUserTier(userId);
    return TIER_LIMITS[tier] || TIER_LIMITS.free;
  }

  async getUsage(userId: string): Promise<UsageSnapshot> {
    const usage = await this.db
      .select()
      .from(subscriptionUsage)
      .where(eq(subscriptionUsage.userId, userId))
      .limit(1);

    const activeGoals = await this.db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId));

    return {
      expensesThisMonth: usage[0]?.expenseCount || 0,
      goalsActive: activeGoals.length,
      groupsActive: 0, // TODO: Query family_groups table when available
      aiQueriesThisMonth: usage[0]?.aiQueryCount || 0,
      receiptOcrThisMonth: usage[0]?.receiptOcrCount || 0,
    };
  }

  async checkLimit(
    userId: string,
    feature: keyof TierLimits,
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const limits = await this.getTierLimits(userId);
    const usage = await this.getUsage(userId);

    const limitValue = limits[feature];
    if (typeof limitValue === 'boolean') {
      return { allowed: limitValue, current: 0, limit: 1 };
    }

    let current = 0;
    switch (feature) {
      case 'maxExpensesPerMonth':
        current = usage.expensesThisMonth;
        break;
      case 'maxGoals':
        current = usage.goalsActive;
        break;
      case 'maxGroups':
        current = usage.groupsActive;
        break;
      case 'maxAiQueriesPerMonth':
        current = usage.aiQueriesThisMonth;
        break;
      case 'receiptOcrPerMonth':
        current = usage.receiptOcrThisMonth;
        break;
    }

    const limit = limitValue as number;
    return {
      allowed: limit === Infinity || current < limit,
      current,
      limit: limit === Infinity ? -1 : limit,
    };
  }

  async incrementUsage(
    userId: string,
    feature: 'expenseCount' | 'aiQueryCount' | 'receiptOcrCount',
  ): Promise<void> {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const existing = await this.db
      .select()
      .from(subscriptionUsage)
      .where(eq(subscriptionUsage.userId, userId))
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(subscriptionUsage)
        .set({
          [feature]: (existing[0][feature] || 0) + 1,
        })
        .where(eq(subscriptionUsage.id, existing[0].id));
    } else {
      await this.db.insert(subscriptionUsage).values({
        userId,
        usageDate: today,
        [feature]: 1,
      } as any);
    }
  }

  async upgradeTier(userId: string, newTier: string): Promise<void> {
    await this.db
      .update(profiles)
      .set({ subscriptionTier: newTier })
      .where(eq(profiles.id, userId));
  }

  // ─── Dynamic tier registry (S5 M1) ──────────────────────────────
  getTiers() {
    return this.db.select().from(subscriptionTiers).orderBy(subscriptionTiers.priceMinor);
  }

  async getTier(key: string) {
    const [tier] = await this.db
      .select()
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.key, key))
      .limit(1);
    if (!tier) throw new NotFoundException('Tier not found');
    return tier;
  }

  // ─── Coupon validation ──────────────────────────────────────────
  async validateCoupon(code: string) {
    const [coupon] = await this.db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.code, code),
          sql`(${coupons.validUntil} IS NULL OR ${coupons.validUntil} >= ${new Date()})`,
        ),
      )
      .limit(1);
    if (!coupon) return { valid: false, reason: 'Invalid or expired coupon' };
    if (coupon.maxUses !== null && coupon.usageCount >= coupon.maxUses) {
      return { valid: false, reason: 'Coupon usage limit reached' };
    }
    return {
      valid: true,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
    };
  }

  // ─── Paywall A/B variants (S5 M4) ───────────────────────────────
  async getPaywallVariant(experimentKey: string, userId: string) {
    const variants = await this.db
      .select()
      .from(paywallVariants)
      .where(and(eq(paywallVariants.key, experimentKey), eq(paywallVariants.isActive, true)));
    if (variants.length === 0) return null;
    const hash = Array.from(userId + experimentKey).reduce((a, c) => a + c.charCodeAt(0), 0);
    const idx = hash % variants.length;
    const chosen = variants[idx];
    await this.db
      .update(paywallVariants)
      .set({ impressions: sql`${paywallVariants.impressions} + 1` })
      .where(eq(paywallVariants.id, chosen.id));
    return chosen;
  }

  async trackConversion(variantId: string) {
    await this.db
      .update(paywallVariants)
      .set({ conversions: sql`${paywallVariants.conversions} + 1` })
      .where(eq(paywallVariants.id, variantId));
    return { tracked: true };
  }

  // ─── Current subscription ───────────────────────────────────────
  async getCurrentSubscription(userId: string) {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    if (!sub) return { tier: 'free' };
    return { tier: sub.plan, expiresAt: sub.expiresAt, status: sub.status };
  }
}
