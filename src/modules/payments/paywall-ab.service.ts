import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, sql, count } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  paywallVariants,
  paywallImpressions,
  userVariantAssignments,
  type PaywallVariant,
  type NewPaywallVariant,
  type NewPaywallImpression,
} from '@db/schema';

export interface PaywallConfig {
  variant: PaywallVariant;
  impressions: number;
  conversions: number;
  conversionRate: number;
}

@Injectable()
export class PaywallAbService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Get user's assigned paywall variant (or assign one). */
  async getUserConfig(userId: string): Promise<PaywallConfig> {
    // Check existing assignment
    const existing = await this.db.query.userVariantAssignments.findFirst({
      where: and(
        eq(userVariantAssignments.userId, userId),
        eq(userVariantAssignments.variantType, 'paywall'),
      ),
    });

    let variantId: string;

    if (existing) {
      variantId = existing.variantId;
    } else {
      // Assign based on traffic distribution
      const activeVariants = await this.db
        .select()
        .from(paywallVariants)
        .where(eq(paywallVariants.isActive, true))
        .orderBy(paywallVariants.displayOrder);

      if (activeVariants.length === 0) {
        throw new NotFoundException('No active paywall variants');
      }

      // Weighted random assignment
      const totalWeight = activeVariants.reduce((sum, v) => sum + v.trafficPercent, 0);
      let random = Math.random() * totalWeight;

      let assigned = activeVariants[0];
      for (const variant of activeVariants) {
        random -= variant.trafficPercent;
        if (random <= 0) {
          assigned = variant;
          break;
        }
      }

      variantId = assigned.id;

      // Persist assignment
      await this.db.insert(userVariantAssignments).values({
        userId,
        variantType: 'paywall',
        variantId,
      });
    }

    const variant = await this.db.query.paywallVariants.findFirst({
      where: eq(paywallVariants.id, variantId),
    });

    if (!variant) throw new NotFoundException('Variant not found');

    // Get metrics
    const impressions = await this.db
      .select({ count: count() })
      .from(paywallImpressions)
      .where(eq(paywallImpressions.variantId, variantId));

    const conversions = await this.db
      .select({ count: count() })
      .from(paywallImpressions)
      .where(
        and(
          eq(paywallImpressions.variantId, variantId),
          eq(paywallImpressions.converted, true),
        ),
      );

    const impressionCount = impressions[0]?.count ?? 0;
    const conversionCount = conversions[0]?.count ?? 0;

    return {
      variant,
      impressions: impressionCount,
      conversions: conversionCount,
      conversionRate: impressionCount > 0 ? (conversionCount / impressionCount) * 100 : 0,
    };
  }

  /** Track a paywall impression. */
  async trackImpression(userId: string, variantId: string) {
    await this.db.insert(paywallImpressions).values({
      userId,
      variantId,
    });
  }

  /** Track a conversion (user subscribed). */
  async trackConversion(userId: string, variantId: string) {
    const existing = await this.db.query.paywallImpressions.findFirst({
      where: and(
        eq(paywallImpressions.userId, userId),
        eq(paywallImpressions.variantId, variantId),
      ),
    });

    if (existing) {
      await this.db
        .update(paywallImpressions)
        .set({ converted: true, convertedAt: new Date() })
        .where(eq(paywallImpressions.id, existing.id));
    }
  }

  /** Admin: CRUD for variants. */
  async listVariants(): Promise<PaywallVariant[]> {
    return this.db.select().from(paywallVariants).orderBy(paywallVariants.displayOrder);
  }

  async createVariant(dto: NewPaywallVariant): Promise<PaywallVariant> {
    const inserted = await this.db.insert(paywallVariants).values(dto).returning();
    return inserted[0];
  }

  async updateVariant(id: string, dto: Partial<NewPaywallVariant>): Promise<PaywallVariant> {
    const updated = await this.db
      .update(paywallVariants)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(paywallVariants.id, id))
      .returning();
    if (!updated[0]) throw new NotFoundException('Variant not found');
    return updated[0];
  }

  /** Admin: Get metrics for all variants. */
  async getMetrics() {
    const variants = await this.listVariants();
    const metrics = await Promise.all(
      variants.map(async (variant) => {
        const impressions = await this.db
          .select({ count: count() })
          .from(paywallImpressions)
          .where(eq(paywallImpressions.variantId, variant.id));

        const conversions = await this.db
          .select({ count: count() })
          .from(paywallImpressions)
          .where(
            and(
              eq(paywallImpressions.variantId, variant.id),
              eq(paywallImpressions.converted, true),
            ),
          );

        const impressionCount = impressions[0]?.count ?? 0;
        const conversionCount = conversions[0]?.count ?? 0;

        return {
          variantId: variant.id,
          variantName: variant.name,
          impressions: impressionCount,
          conversions: conversionCount,
          conversionRate: impressionCount > 0 ? (conversionCount / impressionCount) * 100 : 0,
        };
      }),
    );

    return metrics;
  }
}
