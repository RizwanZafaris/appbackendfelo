import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { eq, and, gte } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { refunds, approvalRequests, type Refund, type NewRefund, type ApprovalRequest } from '@db/schema';
import { StripeService } from './stripe.service';
import { AuditService } from '@/common/services/audit.service';

const TWO_PERSON_THRESHOLD_MINOR = 50_000_00; // PKR 50,000 in paisa

export interface CreateRefundDto {
  userId: string;
  subscriptionId?: string;
  amountMinor: number;
  currency: string;
  reason?: string;
  stripePaymentIntentId?: string;
}

@Injectable()
export class RefundService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  /** List all refunds. */
  async listRefunds() {
    return this.db.select().from(refunds).orderBy(refunds.createdAt);
  }

  /** Create a refund request. For amounts > PKR 50k, requires two-person approval. */
  async createRefund(adminId: string, dto: CreateRefundDto): Promise<{ refund: Refund; needsApproval: boolean; approval?: ApprovalRequest }> {
    // Check if two-person approval is needed
    const needsApproval = dto.amountMinor >= TWO_PERSON_THRESHOLD_MINOR;

    const refundStatus = needsApproval ? 'pending' : 'processing';

    const inserted = await this.db
      .insert(refunds)
      .values({
        userId: dto.userId,
        subscriptionId: dto.subscriptionId ?? null,
        amountMinor: dto.amountMinor,
        currency: dto.currency,
        reason: dto.reason ?? null,
        requestedBy: adminId,
        status: refundStatus,
      })
      .returning();

    const refund = inserted[0];

    let approval: ApprovalRequest | undefined;

    if (needsApproval) {
      const approvalInserted = await this.db
        .insert(approvalRequests)
        .values({
          requestType: 'refund',
          resourceType: 'refund',
          resourceId: refund.id,
          requestedBy: adminId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
          notes: `Refund of ${dto.amountMinor} ${dto.currency} for user ${dto.userId}`,
        })
        .returning();

      approval = approvalInserted[0];
    } else {
      // Auto-execute refund via Stripe if payment intent provided
      if (dto.stripePaymentIntentId) {
        try {
          const stripeRefund = await this.stripe.executeRefund(
            dto.stripePaymentIntentId,
            dto.amountMinor,
          );
          await this.db
            .update(refunds)
            .set({
              status: 'completed',
              stripeRefundId: stripeRefund.id as string,
              updatedAt: new Date(),
            })
            .where(eq(refunds.id, refund.id));
          refund.status = 'completed';
        } catch {
          await this.db
            .update(refunds)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(eq(refunds.id, refund.id));
          refund.status = 'failed';
        }
      }
    }

    return { refund, needsApproval, approval };
  }

  /** Approve a pending refund (second approver). */
  async approveRefund(adminId: string, refundId: string): Promise<Refund> {
    const refund = await this.db.query.refunds.findFirst({
      where: eq(refunds.id, refundId),
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status !== 'pending') throw new BadRequestException('Refund not pending');

    // Find associated approval request
    const approval = await this.db.query.approvalRequests.findFirst({
      where: and(
        eq(approvalRequests.resourceType, 'refund'),
        eq(approvalRequests.resourceId, refundId),
        eq(approvalRequests.status, 'pending'),
      ),
    });

    if (approval) {
      // Server-side: requester cannot approve their own request
      if (approval.requestedBy === adminId) {
        throw new ForbiddenException('Cannot approve your own request');
      }

      await this.db
        .update(approvalRequests)
        .set({
          approvedBy: adminId,
          status: 'approved',
          updatedAt: new Date(),
        })
        .where(eq(approvalRequests.id, approval.id));
    }

    // Execute Stripe refund
    let stripeRefundId: string | undefined;
    if (refund.metadata && (refund.metadata as Record<string, string>).stripePaymentIntentId) {
      try {
        const result = await this.stripe.executeRefund(
          (refund.metadata as Record<string, string>).stripePaymentIntentId,
          refund.amountMinor,
        );
        stripeRefundId = result.id as string;
      } catch {
        // Mark as failed but keep approval record
      }
    }

    const updated = await this.db
      .update(refunds)
      .set({
        status: stripeRefundId ? 'completed' : 'processing',
        approvedBy: adminId,
        stripeRefundId: stripeRefundId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'approve_refund',
      resourceType: 'refund',
      resourceId: refundId,
      metadata: { amountMinor: refund.amountMinor, stripeRefundId },
    });

    return updated[0];
  }

  /** Reject a pending refund. */
  async rejectRefund(adminId: string, refundId: string, reason?: string): Promise<Refund> {
    const refund = await this.db.query.refunds.findFirst({
      where: eq(refunds.id, refundId),
    });
    if (!refund) throw new NotFoundException('Refund not found');

    // Find associated approval request
    const approval = await this.db.query.approvalRequests.findFirst({
      where: and(
        eq(approvalRequests.resourceType, 'refund'),
        eq(approvalRequests.resourceId, refundId),
        eq(approvalRequests.status, 'pending'),
      ),
    });

    if (approval) {
      if (approval.requestedBy === adminId) {
        throw new ForbiddenException('Cannot reject your own request');
      }

      await this.db
        .update(approvalRequests)
        .set({
          rejectedBy: adminId,
          status: 'rejected',
          updatedAt: new Date(),
        })
        .where(eq(approvalRequests.id, approval.id));
    }

    const updated = await this.db
      .update(refunds)
      .set({
        status: 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'reject_refund',
      resourceType: 'refund',
      resourceId: refundId,
      metadata: { reason },
    });

    return updated[0];
  }
}
