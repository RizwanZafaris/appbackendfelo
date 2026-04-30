import { Module } from '@nestjs/common';
import { AnnouncementBannersController } from './announcement-banners.controller';
import { AnnouncementBannersService } from './announcement-banners.service';

@Module({
  controllers: [AnnouncementBannersController],
  providers: [AnnouncementBannersService],
  exports: [AnnouncementBannersService],
})
export class AnnouncementBannersModule {}
