import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, lte } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { notificationCampaigns, profiles } from '@db/schema';

import { NotificationDispatcherService } from './notification-dispatcher.service';

@Injectable()
export class NotificationCampaignsService {
  private readonly log = new Logger(NotificationCampaignsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

  async listCampaigns() {
    return this.db
      .select()
      .from(notificationCampaigns)
      .orderBy(notificationCampaigns.createdAt);
  }

  async createCampaign(dto: {
    name: string;
    templateType: string;
    audienceFilter?: Record<string, unknown>;
    scheduledAt?: string;
  }) {
    const [row] = await this.db
      .insert(notificationCampaigns)
      .values({
        name: dto.name,
        templateType: dto.templateType,
        audienceFilter: dto.audienceFilter ?? {},
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt ? 'scheduled' : 'draft',
      })
      .returning();
    return row;
  }

  async sendCampaign(id: string) {
    const [campaign] = await this.db
      .select()
      .from(notificationCampaigns)
      .where(eq(notificationCampaigns.id, id));
    if (!campaign) throw new NotFoundException('Campaign not found');

    await this.db
      .update(notificationCampaigns)
      .set({ status: 'sending' })
      .where(eq(notificationCampaigns.id, id));

    // Simple audience: all users for now
    // In production, filter by audienceFilter
    const users = await this.db.select({ id: profiles.id }).from(profiles).limit(1000);

    let sent = 0;
    for (const user of users) {
      try {
        await this.dispatcher.dispatch({
          userId: user.id,
          type: campaign.templateType,
          channel: 'inapp',
          variables: { name: campaign.name },
        });
        sent++;
      } catch (e) {
        this.log.warn(`Failed to send to ${user.id}: ${(e as Error).message}`);
      }
    }

    await this.db
      .update(notificationCampaigns)
      .set({ status: 'sent', sentCount: sent })
      .where(eq(notificationCampaigns.id, id));

    return { sent };
  }

  async cancelCampaign(id: string) {
    const [row] = await this.db
      .update(notificationCampaigns)
      .set({ status: 'cancelled' })
      .where(and(eq(notificationCampaigns.id, id), eq(notificationCampaigns.status, 'scheduled')))
      .returning();
    if (!row) throw new NotFoundException('Scheduled campaign not found');
    return { ok: true };
  }

  /** Send scheduled campaigns every 5 minutes. */
  @Cron('*/5 * * * *')
  async processScheduledCampaigns() {
    const now = new Date();
    const scheduled = await this.db
      .select()
      .from(notificationCampaigns)
      .where(
        and(
          eq(notificationCampaigns.status, 'scheduled'),
          lte(notificationCampaigns.scheduledAt, now),
        ),
      );

    for (const campaign of scheduled) {
      try {
        await this.sendCampaign(campaign.id);
        this.log.log(`Sent scheduled campaign ${campaign.id}`);
      } catch (e) {
        this.log.error(`Failed scheduled campaign ${campaign.id}: ${(e as Error).message}`);
      }
    }
  }
}
