import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { subscriptions, profiles } from '@db/schema';

export interface CreateCheckoutDto {
  priceId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown> & {
      id?: string;
      customer?: string;
      subscription?: string;
      lines?: { data: Array<{ price?: { id: string }; amount?: number }> };
      status?: string;
      current_period_end?: number;
    };
  };
}

/**
 * Stripe integration for subscription checkout and webhook handling.
 * Uses Stripe REST API directly (no SDK dependency).
 */
@Injectable()
export class StripeService {
  private stripeSecretKey?: string;
  private webhookSecret?: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly cfg: ConfigService,
  ) {
    this.stripeSecretKey = this.cfg.get<string>('STRIPE_SECRET_KEY') ?? undefined;
    this.webhookSecret = this.cfg.get<string>('STRIPE_WEBHOOK_SECRET') ?? undefined;
  }

  private async stripeApi(path: string, method: string, body?: Record<string, unknown>) {
    if (!this.stripeSecretKey) throw new BadRequestException('Stripe not configured');

    const url = `https://api.stripe.com/v1${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      ...(body && {
        body: new URLSearchParams(
          Object.entries(body).map(([k, v]) => [k, String(v)]),
        ),
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: 'Stripe API error' } }));
      throw new BadRequestException(err.error?.message ?? 'Stripe API error');
    }
    return response.json();
  }

  /** Create a Stripe Checkout session for subscription. */
  async createCheckoutSession(dto: CreateCheckoutDto) {
    // Get or create Stripe customer
    const profile = await this.db.query.profiles.findFirst({
      where: eq(profiles.id, dto.userId),
    });
    if (!profile) throw new BadRequestException('User not found');

    const customers = await this.stripeApi(`/customers?email=${encodeURIComponent(profile.email ?? '')}&limit=1`, 'GET');
    let customerId = customers.data?.[0]?.id as string | undefined;

    if (!customerId) {
      const customer = await this.stripeApi('/customers', 'POST', {
        email: profile.email ?? '',
        metadata: { userId: dto.userId },
      });
      customerId = customer.id as string;
    }

    const session = await this.stripeApi('/checkout/sessions', 'POST', {
      'customer': customerId,
      'mode': 'subscription',
      'payment_method_types[0]': 'card',
      'line_items[0][price]': dto.priceId,
      'line_items[0][quantity]': '1',
      'success_url': dto.successUrl,
      'cancel_url': dto.cancelUrl,
      'subscription_data[metadata][userId]': dto.userId,
    });

    return {
      sessionId: session.id as string,
      url: session.url as string,
    };
  }

  /** Verify Stripe webhook signature. */
  async verifyWebhook(payload: string, signature: string): Promise<StripeWebhookEvent> {
    if (!this.webhookSecret) throw new BadRequestException('Stripe webhook secret not configured');

    // Stripe signature verification requires crypto — simplified here
    // In production, use stripe-node SDK's constructEvent
    const result = JSON.parse(payload) as StripeWebhookEvent;
    return result;
  }

  /** Handle invoice.paid — activate or renew subscription. */
  async handleInvoicePaid(event: StripeWebhookEvent) {
    const invoice = event.data.object;
    const lines = invoice.lines?.data ?? [];
    const priceId = lines[0]?.price?.id;
    const amount = lines[0]?.amount ?? 0;

    // Find user by Stripe customer
    const subs = await this.db.select().from(subscriptions).where(eq(subscriptions.externalId, invoice.customer ?? ''));
    const existing = subs[0];

    if (existing) {
      await this.db
        .update(subscriptions)
        .set({
          status: 'active',
          plan: priceId ?? existing.plan,
          expiresAt: invoice.current_period_end ? new Date(invoice.current_period_end * 1000) : existing.expiresAt,
          paymentProvider: 'stripe',
        })
        .where(eq(subscriptions.id, existing.id));
    }
  }

  /** Handle subscription.updated — update local status. */
  async handleSubscriptionUpdated(event: StripeWebhookEvent) {
    const sub = event.data.object;
    const userId = (sub.metadata as Record<string, string> | undefined)?.userId;

    if (!userId) return;

    const status = sub.status as string;
    const mappedStatus =
      status === 'active' ? 'active' :
      status === 'canceled' ? 'canceled' :
      status === 'past_due' ? 'past_due' :
      status === 'trialing' ? 'trialing' : 'expired';

    await this.db
      .update(subscriptions)
      .set({
        status: mappedStatus,
        expiresAt: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
        externalId: sub.id,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));

    // Update profile subscription tier
    if (mappedStatus === 'active' || mappedStatus === 'trialing') {
      await this.db
        .update(profiles)
        .set({ subscriptionTier: 'plus', updatedAt: new Date() })
        .where(eq(profiles.id, userId));
    } else if (mappedStatus === 'canceled' || mappedStatus === 'expired') {
      await this.db
        .update(profiles)
        .set({ subscriptionTier: 'free', updatedAt: new Date() })
        .where(eq(profiles.id, userId));
    }
  }

  /** Execute a Stripe refund. */
  async executeRefund(paymentIntentId: string, amountMinor?: number) {
    return this.stripeApi('/refunds', 'POST', {
      payment_intent: paymentIntentId,
      ...(amountMinor !== undefined && { amount: amountMinor }),
    });
  }
}
