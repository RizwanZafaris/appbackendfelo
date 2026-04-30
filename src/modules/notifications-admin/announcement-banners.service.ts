import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, gte, desc } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { announcementBanners, type AnnouncementBanner, type NewAnnouncementBanner } from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class AnnouncementBannersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** List all banners. */
  async list(): Promise<AnnouncementBanner[]> {
    return this.db.select().from(announcementBanners).orderBy(desc(announcementBanners.priority));
  }

  /** Create a banner. */
  async create(adminId: string, dto: NewAnnouncementBanner): Promise<AnnouncementBanner> {
    const inserted = await this.db
      .insert(announcementBanners)
      .values({
        name: dto.name,
        titleEn: dto.titleEn,
        titleUr: dto.titleUr ?? null,
        bodyEn: dto.bodyEn ?? null,
        bodyUr: dto.bodyUr ?? null,
        ctaText: dto.ctaText ?? null,
        ctaAction: dto.ctaAction ?? null,
        imageUrl: dto.imageUrl ?? null,
        audience: dto.audience ?? {},
        priority: dto.priority ?? 0,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        isActive: dto.isActive ?? true,
        createdBy: adminId,
      })
      .returning();

    const banner = inserted[0];

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'create',
      resourceType: 'announcement_banner',
      resourceId: banner.id,
      after: banner as unknown as Record<string, unknown>,
    });

    return banner;
  }

  /** Update a banner. */
  async update(adminId: string, id: string, dto: Partial<NewAnnouncementBanner>): Promise<AnnouncementBanner> {
    const existing = await this.db.query.announcementBanners.findFirst({
      where: eq(announcementBanners.id, id),
    });
    if (!existing) throw new NotFoundException('Banner not found');

    const updated = await this.db
      .update(announcementBanners)
      .set({
        ...(dto.name && { name: dto.name }),
        ...(dto.titleEn !== undefined && { titleEn: dto.titleEn }),
        ...(dto.titleUr !== undefined && { titleUr: dto.titleUr }),
        ...(dto.bodyEn !== undefined && { bodyEn: dto.bodyEn }),
        ...(dto.bodyUr !== undefined && { bodyUr: dto.bodyUr }),
        ...(dto.ctaText !== undefined && { ctaText: dto.ctaText }),
        ...(dto.ctaAction !== undefined && { ctaAction: dto.ctaAction }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.audience && { audience: dto.audience }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.startsAt !== undefined && { startsAt: dto.startsAt }),
        ...(dto.endsAt !== undefined && { endsAt: dto.endsAt }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(announcementBanners.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'update',
      resourceType: 'announcement_banner',
      resourceId: id,
      before: existing as unknown as Record<string, unknown>,
      after: updated[0] as unknown as Record<string, unknown>,
    });

    return updated[0];
  }

  /** Delete a banner. */
  async delete(adminId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.db.query.announcementBanners.findFirst({
      where: eq(announcementBanners.id, id),
    });
    if (!existing) throw new NotFoundException('Banner not found');

    await this.db.delete(announcementBanners).where(eq(announcementBanners.id, id));

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'delete',
      resourceType: 'announcement_banner',
      resourceId: id,
    });

    return { ok: true };
  }

  /** Get active banners for a user context. */
  async getActiveForUser(context: { tier?: string; corridor?: string }): Promise<AnnouncementBanner[]> {
    const now = new Date();

    const allActive = await this.db
      .select()
      .from(announcementBanners)
      .where(
        and(
          eq(announcementBanners.isActive, true),
          gte(announcementBanners.endsAt, now),
        ),
      )
      .orderBy(announcementBanners.priority);

    return allActive.filter((banner) => {
      const audience = (banner.audience ?? {}) as Record<string, string[]>;
      if (audience.tiers?.length && context.tier) {
        if (!audience.tiers.includes(context.tier)) return false;
      }
      if (audience.corridors?.length && context.corridor) {
        if (!audience.corridors.includes(context.corridor)) return false;
      }
      return true;
    });
  }
}
ted.');
}
