import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, gte, lte } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { engagementCampaigns, type EngagementCampaign, type NewEngagementCampaign } from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class EngagementCampaignsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** List all campaigns. */
  async list(): Promise<EngagementCampaign[]> {
    return this.db.select().from(engagementCampaigns).orderBy(engagementCampaigns.createdAt);
  }

  /** Create a campaign. */
  async create(adminId: string, dto: NewEngagementCampaign): Promise<EngagementCampaign> {
    const inserted = await this.db
      .insert(engagementCampaigns)
      .values({
        name: dto.name,
        description: dto.description ?? null,
        templateId: dto.templateId,
        audienceFilter: dto.audienceFilter ?? {},
        scheduledAt: dto.scheduledAt ?? null,
        status: 'draft',
        metrics: { sent: 0, delivered: 0, opened: 0 },
        createdBy: adminId,
      })
      .returning();

    const campaign = inserted[0];

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'create',
      resourceType: 'engagement_campaign',
      resourceId: campaign.id,
      after: campaign as unknown as Record<string, unknown>,
    });

    return campaign;
  }

  /** Update a campaign (only if draft). */
  async update(adminId: string, id: string, dto: Partial<NewEngagementCampaign>): Promise<EngagementCampaign> {
    const existing = await this.db.query.engagementCampaigns.findFirst({
      where: eq(engagementCampaigns.id, id),
    });
    if (!existing) throw new NotFoundException('Campaign not found');
    if (existing.status !== 'draft') throw new BadRequestException('Only draft campaigns can be edited');

    const updated = await this.db
      .update(engagementCampaigns)
      .set({
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.templateId && { templateId: dto.templateId }),
        ...(dto.audienceFilter && { audienceFilter: dto.audienceFilter }),
        ...(dto.scheduledAt !== undefined && { scheduledAt: dto.scheduledAt }),
        updatedAt: new Date(),
      })
      .where(eq(engagementCampaigns.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'update',
      resourceType: 'engagement_campaign',
      resourceId: id,
      before: existing as unknown as Record<string, unknown>,
      after: updated[0] as unknown as Record<string, unknown>,
    });

    return updated[0];
  }

  /** Schedule a campaign. */
  async schedule(adminId: string, id: string, scheduledAt: Date): Promise<EngagementCampaign> {
    const existing = await this.db.query.engagementCampaigns.findFirst({
      where: eq(engagementCampaigns.id, id),
    });
    if (!existing) throw new NotFoundException('Campaign not found');
    if (existing.status !== 'draft') throw new BadRequestException('Only draft campaigns can be scheduled');

    const updated = await this.db
      .update(engagementCampaigns)
      .set({
        status: 'scheduled',
        scheduledAt,
        updatedAt: new Date(),
      })
      .where(eq(engagementCampaigns.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'schedule',
      resourceType: 'engagement_campaign',
      resourceId: id,
      metadata: { scheduledAt: scheduledAt.toISOString() },
    });

    return updated[0];
  }

  /** Cancel a scheduled campaign. */
  async cancel(adminId: string, id: string): Promise<EngagementCampaign> {
    const existing = await this.db.query.engagementCampaigns.findFirst({
      where: eq(engagementCampaigns.id, id),
    });
    if (!existing) throw new NotFoundException('Campaign not found');
    if (existing.status !== 'scheduled' && existing.status !== 'draft') {
      throw new BadRequestException('Cannot cancel a sent campaign');
    }

    const updated = await this.db
      .update(engagementCampaigns)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(engagementCampaigns.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'cancel',
      resourceType: 'engagement_campaign',
      resourceId: id,
    });

    return updated[0];
  }

  /** Update campaign metrics. */
  async updateMetrics(id: string, metrics: { sent?: number; delivered?: number; opened?: number }) {
    const existing = await this.db.query.engagementCampaigns.findFirst({
      where: eq(engagementCampaigns.id, id),
    });
    if (!existing) return;

    const current = (existing.metrics ?? {}) as Record<string, number>;
    const newMetrics = {
      sent: (current.sent ?? 0) + (metrics.sent ?? 0),
      delivered: (current.delivered ?? 0) + (metrics.delivered ?? 0),
      opened: (current.opened ?? 0) + (metrics.opened ?? 0),
    };

    await this.db
      .update(engagementCampaigns)
      .set({ metrics: newMetrics, updatedAt: new Date() })
      .where(eq(engagementCampaigns.id, id));
  }

  /** Delete a campaign. */
  async delete(adminId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.db.query.engagementCampaigns.findFirst({
      where: eq(engagementCampaigns.id, id),
    });
    if (!existing) throw new NotFoundException('Campaign not found');

    await this.db.delete(engagementCampaigns).where(eq(engagementCampaigns.id, id));

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'delete',
      resourceType: 'engagement_campaign',
      resourceId: id,
    });

    return { ok: true };
  }
}
