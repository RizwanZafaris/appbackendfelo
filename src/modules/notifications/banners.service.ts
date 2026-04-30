import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { announcementBanners } from '@db/schema';

@Injectable()
export class BannersService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async listActive() {
    const now = new Date();
    return this.db
      .select()
      .from(announcementBanners)
      .where(
        and(
          eq(announcementBanners.isActive, true),
          sql`(${announcementBanners.startAt} IS NULL OR ${announcementBanners.startAt} <= ${now})`,
          sql`(${announcementBanners.endAt} IS NULL OR ${announcementBanners.endAt} >= ${now})`,
        ),
      )
      .orderBy(desc(announcementBanners.priority));
  }

  async listAll(cursor?: string, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    if (cursor) {
      return this.db
        .select()
        .from(announcementBanners)
        .where(sql`${announcementBanners.createdAt} < ${new Date(cursor)}`)
        .orderBy(desc(announcementBanners.createdAt))
        .limit(safeLimit);
    }
    return this.db
      .select()
      .from(announcementBanners)
      .orderBy(desc(announcementBanners.createdAt))
      .limit(safeLimit);
  }

  async create(data: {
    titleEn: string;
    titleUr?: string;
    body: string;
    actionUrl?: string;
    audience?: Record<string, unknown>;
    priority?: number;
    startAt?: Date;
    endAt?: Date;
  }) {
    const [row] = await this.db
      .insert(announcementBanners)
      .values({
        titleEn: data.titleEn,
        titleUr: data.titleUr,
        bodyEn: data.body,
        bodyUr: undefined,
        actionUrl: data.actionUrl,
        audienceFilter: data.audience ?? {},
        priority: data.priority ?? 0,
        startAt: data.startAt,
        endAt: data.endAt,
        isActive: true,
      } as never)
      .returning();
    return row;
  }

  async update(
    id: string,
    data: Partial<{
      titleEn: string;
      titleUr: string;
      body: string;
      actionUrl: string;
      audience: Record<string, unknown>;
      priority: number;
      startAt: Date;
      endAt: Date;
      isActive: boolean;
    }>,
  ) {
    const update: Record<string, unknown> = {};
    if (data.titleEn !== undefined) update.titleEn = data.titleEn;
    if (data.titleUr !== undefined) update.titleUr = data.titleUr;
    if (data.body !== undefined) update.bodyEn = data.body;
    if (data.actionUrl !== undefined) update.actionUrl = data.actionUrl;
    if (data.audience !== undefined) update.audienceFilter = data.audience;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.startAt !== undefined) update.startAt = data.startAt;
    if (data.endAt !== undefined) update.endAt = data.endAt;
    if (data.isActive !== undefined) update.isActive = data.isActive;
    const [row] = await this.db
      .update(announcementBanners)
      .set(update as never)
      .where(eq(announcementBanners.id, id))
      .returning();
    if (!row) throw new NotFoundException('Banner not found');
    return row;
  }

  async remove(id: string) {
    const result = await this.db
      .delete(announcementBanners)
      .where(eq(announcementBanners.id, id))
      .returning();
    if (!result[0]) throw new NotFoundException('Banner not found');
    return { deleted: true };
  }
}
