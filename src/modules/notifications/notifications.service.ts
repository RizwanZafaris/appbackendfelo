import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { devices, notifications } from '@db/schema';

import { CreateNotificationDto, RegisterDeviceDto } from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // ---- Notifications ----

  list(userId: string, opts: { unreadOnly?: boolean } = {}) {
    const where = opts.unreadOnly
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : eq(notifications.userId, userId);
    return this.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(100);
  }

  async create(userId: string, dto: CreateNotificationDto) {
    const [inserted] = await this.db
      .insert(notifications)
      .values({
        userId,
        channel: dto.channel,
        type: dto.type,
        title: dto.title,
        body: dto.body ?? null,
        ...(dto.payload ? { payload: dto.payload } : {}),
      })
      .returning();
    return inserted;
  }

  async unreadCount(userId: string) {
    const rows = await this.db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { count: Number(rows[0]?.c ?? 0) };
  }

  async markRead(userId: string, id: string) {
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundException('Notification not found');
    return updated;
  }

  async markAllRead(userId: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true };
  }

  async remove(userId: string, id: string) {
    await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    return { ok: true };
  }

  // ---- Devices ----

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const [row] = await this.db
      .insert(devices)
      .values({
        userId,
        platform: dto.platform,
        pushToken: dto.pushToken,
        isTrusted: false,
      })
      .onConflictDoUpdate({
        target: [devices.userId, devices.pushToken],
        set: {
          platform: dto.platform,
          lastSeenAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  listDevices(userId: string) {
    return this.db
      .select()
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(desc(devices.lastSeenAt));
  }

  async removeDevice(userId: string, id: string) {
    await this.db.delete(devices).where(and(eq(devices.id, id), eq(devices.userId, userId)));
    return { ok: true };
  }

  // ---- Metrics ----

  async metrics(days = 30) {
    const totalSent = await this.db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(
        sql`${notifications.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`,
      );

    const totalRead = await this.db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(
        and(
          sql`${notifications.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`,
          sql`${notifications.readAt} IS NOT NULL`,
        ),
      );

    const byType = await this.db
      .select({
        type: notifications.type,
        count: sql<number>`COUNT(*)::int`,
        readCount: sql<number>`COUNT(CASE WHEN ${notifications.readAt} IS NOT NULL THEN 1 END)::int`,
      })
      .from(notifications)
      .where(
        sql`${notifications.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`,
      )
      .groupBy(notifications.type);

    return {
      days,
      totalSent: Number(totalSent[0]?.c ?? 0),
      totalRead: Number(totalRead[0]?.c ?? 0),
      readRate:
        totalSent[0]?.c > 0
          ? Math.round((Number(totalRead[0]?.c ?? 0) / Number(totalSent[0]?.c ?? 1)) * 100)
          : 0,
      byType,
    };
  }
}
