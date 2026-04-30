import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  subscriptionTiers,
  tierEntitlements,
  subscriptionUsage,
  profiles,
  type SubscriptionTier,
  type TierEntitlement,
  type NewSubscriptionTier,
  type NewTierEntitlement,
} from '@db/schema';

@Injectable()
export class TierManagementService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** List all subscription tiers with their entitlements. */
  async listTiers(): Promise<(SubscriptionTier & { entitlements: TierEntitlement[] })[]> {
    const tiers = await this.db.select().from(subscriptionTiers).where(eq(subscriptionTiers.isActive, true));
    const entitlements = await this.db.select().from(tierEntitlements);

    return tiers.map((tier) => ({
      ...tier,
      entitlements: entitlements.filter((e) => e.tierId === tier.id),
    }));
  }

  /** Create a new subscription tier. */
  async createTier(dto: NewSubscriptionTier & { entitlements?: NewTierEntitlement[] }) {
    const inserted = await this.db
      .insert(subscriptionTiers)
      .values({
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description ?? null,
        priceMinor: dto.priceMinor ?? null,
        currency: dto.currency ?? 'PKR',
        interval: dto.interval ?? 'monthly',
        stripePriceId: dto.stripePriceId ?? null,
        revenuecatIdentifier: dto.revenuecatIdentifier ?? null,
        abSplit: dto.abSplit ?? 50,
      })
      .returning();

    const tier = inserted[0];

    if (dto.entitlements?.length) {
      await this.db.insert(tierEntitlements).values(
        dto.entitlements.map((e) => ({
          tierId: tier.id,
          feature: e.feature,
          limit: e.limit ?? null,
          period: e.period ?? null,
        })),
      );
    }

    return tier;
  }

  /** Update a subscription tier. */
  async updateTier(id: string, dto: Partial<NewSubscriptionTier> & { entitlements?: NewTierEntitlement[] }) {
    const updated = await this.db
      .update(subscriptionTiers)
      .set({
        ...(dto.name && { name: dto.name }),
        ...(dto.displayName && { displayName: dto.displayName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priceMinor !== undefined && { priceMinor: dto.priceMinor }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.interval && { interval: dto.interval }),
        ...(dto.stripePriceId !== undefined && { stripePriceId: dto.stripePriceId }),
        ...(dto.revenuecatIdentifier !== undefined && { revenuecatIdentifier: dto.revenuecatIdentifier }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.abSplit !== undefined && { abSplit: dto.abSplit }),
        updatedAt: new Date(),
      })
      .where(eq(subscriptionTiers.id, id))
      .returning();

    if (!updated[0]) throw new NotFoundException('Tier not found');

    if (dto.entitlements) {
      // Replace all entitlements
      await this.db.delete(tierEntitlements).where(eq(tierEntitlements.tierId, id));
      if (dto.entitlements.length > 0) {
        await this.db.insert(tierEntitlements).values(
          dto.entitlements.map((e) => ({
            tierId: id,
            feature: e.feature,
            limit: e.limit ?? null,
            period: e.period ?? null,
          })),
        );
      }
    }

    return updated[0];
  }

  /** List entitlements for a tier. */
  async getEntitlements(tierId: string): Promise<TierEntitlement[]> {
    return this.db.select().from(tierEntitlements).where(eq(tierEntitlements.tierId, tierId));
  }

  /** Check if a user can use a specific feature based on their tier + usage. */
  async canUseFeature(userId: string, feature: string): Promise<{ allowed: boolean; remaining?: number; limit?: number }> {
    // Get user's current tier
    const profile = await this.db.query.profiles.findFirst({
      where: eq(profiles.id, userId),
    });
    if (!profile) return { allowed: false };

    const tierName = profile.subscriptionTier ?? 'free';

    // Find tier
    const tier = await this.db.query.subscriptionTiers.findFirst({
      where: eq(subscriptionTiers.name, tierName),
    });
    if (!tier) return { allowed: false };

    // Check entitlement
    const entitlement = await this.db.query.tierEntitlements.findFirst({
      where: and(eq(tierEntitlements.tierId, tier.id), eq(tierEntitlements.feature, feature)),
    });

    if (!entitlement) {
      // Feature not in tier — deny for free, allow for paid if not explicitly limited
      return { allowed: tierName !== 'free', limit: tierName !== 'free' ? undefined : 0, remaining: tierName !== 'free' ? undefined : 0 };
    }

    if (entitlement.limit === null || entitlement.limit === undefined) {
      return { allowed: true }; // unlimited
    }

    // Check current usage
    const today = new Date().toISOString().slice(0, 10);
    const usage = await this.db.query.subscriptionUsage.findFirst({
      where: and(
        eq(subscriptionUsage.userId, userId),
        eq(subscriptionUsage.usageDate, today),
      ),
    });

    let used = 0;
    if (feature === 'ocr') used = usage?.receiptOcrCount ?? 0;
    else if (feature === 'ai') used = usage?.aiQueryCount ?? 0;

    const remaining = Math.max(0, entitlement.limit - used);
    return { allowed: remaining > 0, remaining, limit: entitlement.limit };
  }

  /** Increment feature usage for a user. */
  async incrementUsage(userId: string, feature: 'ocr' | 'ai' | 'expense') {
    const today = new Date().toISOString().slice(0, 10);

    const existing = await this.db.query.subscriptionUsage.findFirst({
      where: and(eq(subscriptionUsage.userId, userId), eq(subscriptionUsage.usageDate, today)),
    });

    if (existing) {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (feature === 'ocr') updateData.receiptOcrCount = sql`${subscriptionUsage.receiptOcrCount} + 1`;
      if (feature === 'ai') updateData.aiQueryCount = sql`${subscriptionUsage.aiQueryCount} + 1`;
      if (feature === 'expense') updateData.expenseCount = sql`${subscriptionUsage.expenseCount} + 1`;

      await this.db
        .update(subscriptionUsage)
        .set(updateData)
        .where(eq(subscriptionUsage.id, existing.id));
    } else {
      await this.db.insert(subscriptionUsage).values({
        userId,
        usageDate: today,
        receiptOcrCount: feature === 'ocr' ? 1 : 0,
        aiQueryCount: feature === 'ai' ? 1 : 0,
        expenseCount: feature === 'expense' ? 1 : 0,
      });
    }
  }

  /** Seed default tiers (free + plus). */
  async seedDefaults() {
    const existing = await this.db.select().from(subscriptionTiers);
    if (existing.length > 0) return;

    // Free tier
    const free = await this.createTier({
      name: 'free',
      displayName: 'Free',
      description: 'Basic plan with limited features',
      entitlements: [
        { feature: 'ocr', limit: 10, period: 'monthly' },
        { feature: 'ai', limit: 5, period: 'monthly' },
        { feature: 'export', limit: 0, period: 'monthly' },
      ],
    });

    // Plus tier
    await this.createTier({
      name: 'plus',
      displayName: 'Felo Plus',
      description: 'Unlimited access to all features',
      priceMinor: 50000, // PKR 500
      currency: 'PKR',
      interval: 'monthly',
      entitlements: [
        { feature: 'ocr', limit: null, period: null }, // unlimited
        { feature: 'ai', limit: null, period: null },
        { feature: 'export', limit: null, period: null },
      ],
    });

    return { free, plus: true };
  }
}
