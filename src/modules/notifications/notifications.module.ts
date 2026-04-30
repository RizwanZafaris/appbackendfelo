import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationTriggersService } from './triggers.service';
import { BannersService } from './banners.service';

@Module({
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService, NotificationTriggersService, BannersService],
  exports: [NotificationsService, NotificationTriggersService, BannersService],
})
export class NotificationsModule {}
