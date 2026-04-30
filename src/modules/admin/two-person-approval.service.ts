import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { eq, and, gt } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { approvalRequests, type ApprovalRequest, type NewApprovalRequest } from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class TwoPersonApprovalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** List pending approval requests. */
  async listPending(): Promise<ApprovalRequest[]> {
    return this.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.status, 'pending'),
          gt(approvalRequests.expiresAt, new Date()),
        ),
      )
      .orderBy(approvalRequests.createdAt);
  }

  /** Create an approval request. */
  async create(actorId: string, dto: Omit<NewApprovalRequest, 'requestedBy'>): Promise<ApprovalRequest> {
    const inserted = await this.db
      .insert(approvalRequests)
      .values({
        requestType: dto.requestType,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        requestedBy: actorId,
        status: 'pending',
        expiresAt: dto.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000),
        notes: dto.notes ?? null,
      })
      .returning();

    const req = inserted[0];

    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'request_approval',
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      metadata: { requestType: dto.requestType, notes: dto.notes },
    });

    return req;
  }

  /** Approve a pending request (second approver). */
  async approve(actorId: string, id: string): Promise<ApprovalRequest> {
    const req = await this.db.query.approvalRequests.findFirst({
      where: eq(approvalRequests.id, id),
    });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'pending') throw new BadRequestException('Request already processed');
    if (new Date() > req.expiresAt) throw new BadRequestException('Request expired');

    // Server-side: requester cannot approve their own request
    if (req.requestedBy === actorId) {
      throw new ForbiddenException('Cannot approve your own request');
    }

    const updated = await this.db
      .update(approvalRequests)
      .set({
        approvedBy: actorId,
        status: 'approved',
        updatedAt: new Date(),
      })
      .where(eq(approvalRequests.id, id))
      .returning();

    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'approve',
      resourceType: req.resourceType,
      resourceId: req.resourceId,
      metadata: { requestId: id },
    });

    return updated[0];
  }

  /** Reject a pending request. */
  async reject(actorId: string, id: string, reason?: string): Promise<ApprovalRequest> {
    const req = await this.db.query.approvalRequests.findFirst({
      where: eq(approvalRequests.id, id),
    });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'pending') throw new BadRequestException('Request already processed');

    // Server-side: requester cannot reject their own request
    if (req.requestedBy === actorId) {
      throw new ForbiddenException('Cannot reject your own request');
    }

    const updated = await this.db
      .update(approvalRequests)
      .set({
        rejectedBy: actorId,
        status: 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(approvalRequests.id, id))
      .returning();

    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'reject',
      resourceType: req.resourceType,
      resourceId: req.resourceId,
      metadata: { requestId: id, reason },
    });

    return updated[0];
  }
}
