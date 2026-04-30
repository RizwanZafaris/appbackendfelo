import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { KYC_PROVIDER, KycProvider } from '@/integrations/kyc/kyc-provider.port';
import { kycChecks, profiles } from '@db/schema';

export interface InitiateKycDto {
  firstName: string;
  lastName: string;
  email?: string;
  dob?: string;
  address?: {
    line1: string;
    city: string;
    country: string;
    postcode?: string;
  };
}

export interface ReviewKycDto {
  result: 'clear' | 'consider' | 'unverified';
  note?: string;
  reviewedBy: string;
}

@Injectable()
export class KycService {
  private readonly log = new Logger(KycService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
  ) {}

  async initiate(userId: string, dto: InitiateKycDto) {
    this.log.log(`Starting KYC for user ${userId} via ${this.provider.name}`);

    const result = await this.provider.initiate({
      userId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      dob: dto.dob,
      address: dto.address,
    });

    const [row] = await this.db
      .insert(kycChecks)
      .values({
        userId,
        provider: this.provider.name,
        providerCheckId: result.providerCheckId,
        status: result.status,
        result: result.result ?? null,
        vendorPayload: result.vendorPayload,
      })
      .returning();

    // Update profile kyc_status
    await this.db
      .update(profiles)
      .set({ kycStatus: 'in_progress' })
      .where(eq(profiles.id, userId));

    return row;
  }

  async status(userId: string) {
    const rows = await this.db
      .select()
      .from(kycChecks)
      .where(eq(kycChecks.userId, userId))
      .orderBy(desc(kycChecks.createdAt))
      .limit(1);

    if (!rows[0]) return { status: 'not_started' as const };

    // If pending/in_progress, refresh from provider
    if (rows[0].status === 'pending' || rows[0].status === 'in_progress') {
      try {
        const refreshed = await this.provider.status(rows[0].providerCheckId!);
        const [updated] = await this.db
          .update(kycChecks)
          .set({
            status: refreshed.status,
            result: refreshed.result ?? null,
            vendorPayload: refreshed.vendorPayload,
            updatedAt: new Date(),
          })
          .where(eq(kycChecks.id, rows[0].id))
          .returning();
        return updated ?? rows[0];
      } catch (e) {
        this.log.warn(`Provider refresh failed: ${(e as Error).message}`);
        return rows[0];
      }
    }

    return rows[0];
  }

  async handleWebhook(provider: string, payload: Record<string, unknown>) {
    this.log.log(`Webhook from ${provider}: ${JSON.stringify(payload).slice(0, 200)}`);

    const parsed = this.provider.parseWebhook(payload);

    const row = await this.db.query.kycChecks.findFirst({
      where: eq(kycChecks.providerCheckId, parsed.providerCheckId),
    });

    if (!row) {
      this.log.warn(`No kyc check found for providerCheckId ${parsed.providerCheckId}`);
      return { acknowledged: false };
    }

    // Refresh full status from provider
    const refreshed = await this.provider.status(parsed.providerCheckId);

    await this.db
      .update(kycChecks)
      .set({
        status: refreshed.status,
        result: refreshed.result ?? null,
        vendorPayload: {
          ...refreshed.vendorPayload,
          webhookEvent: parsed.event,
        },
        updatedAt: new Date(),
      })
      .where(eq(kycChecks.id, row.id));

    // Sync profile kyc_status
    const profileStatus =
      refreshed.result === 'clear'
        ? 'approved'
        : refreshed.result === 'consider'
          ? 'rejected'
          : 'submitted';

    await this.db
      .update(profiles)
      .set({ kycStatus: profileStatus })
      .where(eq(profiles.id, row.userId));

    return { acknowledged: true, checkId: row.id, status: refreshed.status };
  }

  // ---- Admin ----

  async listReviews(opts: { status?: string; limit?: number; offset?: number } = {}) {
    const { limit = 50 } = opts;
    return this.db
      .select()
      .from(kycChecks)
      .orderBy(desc(kycChecks.createdAt))
      .limit(limit);
  }

  async review(id: string, dto: ReviewKycDto) {
    const [updated] = await this.db
      .update(kycChecks)
      .set({
        result: dto.result,
        reviewNote: dto.note ?? null,
        reviewedBy: dto.reviewedBy,
        status: 'complete',
        updatedAt: new Date(),
      })
      .where(eq(kycChecks.id, id))
      .returning();

    if (!updated) throw new NotFoundException('KYC check not found');

    // Sync profile
    const profileStatus = dto.result === 'clear' ? 'approved' : 'rejected';
    await this.db
      .update(profiles)
      .set({ kycStatus: profileStatus })
      .where(eq(profiles.id, updated.userId));

    return updated;
  }
}
