import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { subscriptions, profiles } from '@db/schema';

export interface RevenueCatWebhookEvent {
  event: {
    type: 'INITIAL_PURCHASE' | 'RENEWAL' | 'CANCELLATION' | 'UNCANCELLATION' | 'EXPIRATION' | 'BILLING_ISSUE';
    app_user_id: string;
    product_id: string;
    expiration_at_ms?: number;
    cancellation_reason?: string;
    transaction_id: string;
    environment: 'SANDBOX' | 'PRODUCTION';
  };
}

/**
 * RevenueCat webhook handler for cross-platform subscription events.
 */
@Injectable()
export class RevenueCatService {
  private authHeader?: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly cfg: ConfigService,
  ) {
    this.authHeader = this.cfg.get<string>('REVENUECAT_AUTH_HEADER') ?? undefined;
  }

  /** Verify RevenueCat webhook authorization. */
  verifyWebhook(headers: Record<string, string>): boolean {
    if (!this.authHeader) return true; // Dev mode
    const auth = headers['authorization'] ?? '';
    return auth === this.authHeader;
  }

  /** Process a RevenueCat event. */
  async processEvent(event: RevenueCatWebhookEvent['event']) {
    const userId = event.app_user_id;

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
        await this.activateSubscription(userId, event.product_id, event.expiration_at_ms);
        break;
      case 'CANCELLATION':
      case 'EXPIRATION':
        await this.deactivateSubscription(userId);
        break;
      case 'UNCANCELLATION':
        await this.activateSubscription(userId, event.product_id, event.expiration_at_ms);
        break;
      default:
        break;
    }
  }

  private async activateSubscription(userId: string, plan: string, expirationMs?: number) {
    const existing = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (existing) {
      await this.db
        .update(subscriptions)
        .set({
          status: 'active',
          plan,
          paymentProvider: 'revenuecat',
          expiresAt: expirationMs ? new Date(expirationMs) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existing.id));
    } else {
      await this.db.insert(subscriptions).values({
        userId,
        plan,
        status: 'active',
        paymentProvider: 'revenuecat',
        expiresAt: expirationMs ? new Date(expirationMs) : undefined,
      });
    }

    await this.db
      .update(profiles)
      .set({ subscriptionTier: 'plus', updatedAt: new Date() })
      .where(eq(profiles.id, userId));
  }

  private async deactivateSubscription(userId: string) {
    const existing = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (existing) {
      await this.db
        .update(subscriptions)
        .set({
          status: 'canceled',
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existing.id));
    }

    await this.db
      .update(profiles)
      .set({ subscriptionTier: 'free', updatedAt: new Date() })
      .where(eq(profiles.id, userId));
  }
}
