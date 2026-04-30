import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { devices, notifications, notificationTemplates } from '@db/schema';

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
        // `payload` is the typed contract for the Flutter client. The
        // Drizzle column has a `'{}'::jsonb` default; only override when
        // the caller supplies one.
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

  // ---- Devices ------------------------------------------------------
  /**
   * Idempotent device registration. Backed by the UNIQUE (user_id,
   * push_token) constraint added in 003_sprint4_hardening.sql —
   * concurrent calls converge on a single row.
   *
   * NOTE: `isTrusted` is intentionally **not** taken from the client
   * payload. Trust is a server-side decision (e.g., set after MFA
   * verification on this device); accepting it from the wire would
   * let a client bypass any future trusted-device 2FA-skip rule.
   */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const [row] = await this.db
      .insert(devices)
      .values({
        userId,
        platform: dto.platform,
        pushToken: dto.pushToken,
        isTrusted: false, // server-set only
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

  // ---- Template-driven dispatch (S7 E1) -----------------------------
  /**
   * Render a notification from a stored template + variables and persist
   * it as an in-app notification row. Future enhancement: fan-out to FCM
   * / APNs / email via integration adapters.
   */
  async dispatch(
    userId: string,
    templateKey: string,
    variables: Record<string, string>,
    channel?: 'push' | 'email' | 'inapp' | 'sms',
  ) {
    const [template] = await this.db
      .select()
      .from(notificationTemplates)
      .where(
        and(eq(notificationTemplates.key, templateKey), eq(notificationTemplates.isActive, true)),
      )
      .limit(1);
    if (!template) return { sent: false, reason: 'Template not found' };

    const render = (s: string | null) => {
      if (!s) return '';
      return Object.entries(variables).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`{{${k}}}`, 'g'), v),
        s,
      );
    };
    const title = render(template.titleEn);
    const body = render(template.bodyEn);

    const [row] = await this.db
      .insert(notifications)
      .values({
        userId,
        channel: (channel ?? template.channel) as never,
        type: templateKey,
        title,
        body,
        payload: { templateKey, variables },
      } as never)
      .returning();
    return { sent: true, channel: channel ?? template.channel, notificationId: row.id, title, body };
  }
}
