import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
