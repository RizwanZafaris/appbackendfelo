import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { notificationTriggers } from '@db/schema';

@Injectable()
export class NotificationTriggersService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async list(cursor?: string, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    if (cursor) {
      return this.db
        .select()
        .from(notificationTriggers)
        .where(sql`${notificationTriggers.createdAt} < ${new Date(cursor)}`)
        .orderBy(desc(notificationTriggers.createdAt))
        .limit(safeLimit);
    }
    return this.db
      .select()
      .from(notificationTriggers)
      .orderBy(desc(notificationTriggers.createdAt))
      .limit(safeLimit);
  }

  async create(data: {
    ruleKey: string;
    conditionDsl: Record<string, unknown>;
    templateKey: string;
    channelPriority?: unknown[];
    throttlePerDay?: number;
    audience?: Record<string, unknown>;
  }) {
    const [row] = await this.db
      .insert(notificationTriggers)
      .values({
        ruleKey: data.ruleKey,
        conditionDsl: data.conditionDsl,
        templateKey: data.templateKey,
        channelPriority: (data.channelPriority ?? []) as unknown[],
        throttlePerDay: data.throttlePerDay ?? 1,
        audience: data.audience ?? {},
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    data: Partial<{
      conditionDsl: Record<string, unknown>;
      templateKey: string;
      channelPriority: unknown[];
      throttlePerDay: number;
      audience: Record<string, unknown>;
      isActive: boolean;
    }>,
  ) {
    const update: Record<string, unknown> = {};
    if (data.conditionDsl !== undefined) update.conditionDsl = data.conditionDsl;
    if (data.templateKey !== undefined) update.templateKey = data.templateKey;
    if (data.channelPriority !== undefined) update.channelPriority = data.channelPriority;
    if (data.throttlePerDay !== undefined) update.throttlePerDay = data.throttlePerDay;
    if (data.audience !== undefined) update.audience = data.audience;
    if (data.isActive !== undefined) update.isActive = data.isActive;
    const [row] = await this.db
      .update(notificationTriggers)
      .set(update as never)
      .where(eq(notificationTriggers.id, id))
      .returning();
    if (!row) throw new NotFoundException('Trigger not found');
    return row;
  }

  async remove(id: string) {
    const result = await this.db
      .delete(notificationTriggers)
      .where(eq(notificationTriggers.id, id))
      .returning();
    if (!result[0]) throw new NotFoundException('Trigger not found');
    return { deleted: true };
  }
}
