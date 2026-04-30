import { Module } from '@nestjs/common';
import { NotificationTemplatesController } from './notification-templates.controller';
import { NotificationTemplatesService } from './notification-templates.service';

@Module({
  controllers: [NotificationTemplatesController],
  providers: [NotificationTemplatesService],
  exports: [NotificationTemplatesService],
})
export class NotificationTemplatesModule {}
