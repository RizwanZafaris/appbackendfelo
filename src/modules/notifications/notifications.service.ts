import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { devices, notifications } from '@db/schema';

import { CreateNotificationDto, RegisterDeviceDto } from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // ---- Notifications ------------------------------------------------
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

  // ---- Devices ------------------------------------------------------
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    // Upsert by (user_id, push_token) — device-level uniqueness.
    const existing = await this.db.query.devices.findFirst({
      where: and(eq(devices.userId, userId), eq(devices.pushToken, dto.pushToken)),
    });
    if (existing) {
      const [updated] = await this.db
        .update(devices)
        .set({
          platform: dto.platform,
          isTrusted: dto.isTrusted ?? existing.isTrusted,
          lastSeenAt: new Date(),
        })
        .where(eq(devices.id, existing.id))
        .returning();
      return updated;
    }
    const [inserted] = await this.db
      .insert(devices)
      .values({
        userId,
        platform: dto.platform,
        pushToken: dto.pushToken,
        isTrusted: dto.isTrusted ?? false,
      })
      .returning();
    return inserted;
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
}
