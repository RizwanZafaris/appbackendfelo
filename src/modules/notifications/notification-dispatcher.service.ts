import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { devices, notifications } from '@db/schema';

import { NotificationTemplateService } from './notification-template.service';

export interface DispatchInput {
  userId: string;
  type: string;
  channel: 'push' | 'email' | 'inapp' | 'sms';
  variables: Record<string, string>;
  language?: 'en' | 'ur';
  payload?: Record<string, unknown>;
}

@Injectable()
export class NotificationDispatcherService {
  private readonly log = new Logger(NotificationDispatcherService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly templateSvc: NotificationTemplateService,
    private readonly cfg: ConfigService,
  ) {}

  /** Fan-out a notification via all registered FCM devices. */
  async dispatch(input: DispatchInput) {
    const rendered = await this.templateSvc.render(
      input.type,
      input.variables,
      input.language ?? 'en',
    );

    // Persist in-app notification
    const [inApp] = await this.db
      .insert(notifications)
      .values({
        userId: input.userId,
        channel: input.channel,
        type: input.type,
        title: rendered.title,
        body: rendered.body,
        payload: input.payload ?? {},
        sentAt: new Date(),
      })
      .returning();

    // Push via FCM if push channel
    if (input.channel === 'push') {
      await this.sendPush(input.userId, rendered.title, rendered.body, input.payload);
    }

    return inApp;
  }

  private async sendPush(
    userId: string,
    title: string,
    body: string,
    payload?: Record<string, unknown>,
  ) {
    const userDevices = await this.db
      .select()
      .from(devices)
      .where(eq(devices.userId, userId));

    const fcmKey = this.cfg.get<string>('FCM_SERVER_KEY');
    if (!fcmKey) {
      this.log.warn('FCM_SERVER_KEY not configured, skipping push');
      return;
    }

    for (const device of userDevices) {
      try {
        await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `key=${fcmKey}`,
          },
          body: JSON.stringify({
            to: device.pushToken,
            notification: { title, body },
            data: payload ?? {},
          }),
        });
        this.log.debug(`Push sent to device ${device.id}`);
      } catch (e) {
        this.log.warn(`Push failed for device ${device.id}: ${(e as Error).message}`);
      }
    }
  }
}
