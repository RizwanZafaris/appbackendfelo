import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuditLogModule } from '@/modules/audit-log/audit-log.module';

import { NotificationCampaignsService } from './notification-campaigns.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationTriggersService } from './notification-triggers.service';
import { NotificationsAdminController } from './notifications-admin.controller';
import { DevicesController } from './devices.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [ScheduleModule.forRoot(), AuditLogModule],
  controllers: [
    NotificationsController,
    DevicesController,
    NotificationsAdminController,
  ],
  providers: [
    NotificationsService,
    NotificationTemplateService,
    NotificationDispatcherService,
    NotificationTriggersService,
    NotificationCampaignsService,
  ],
  exports: [
    NotificationsService,
    NotificationDispatcherService,
    NotificationTemplateService,
  ],
})
export class NotificationsModule {}
