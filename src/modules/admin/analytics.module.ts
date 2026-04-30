import { Module } from '@nestjs/common';
import { AdminAnalyticsController } from './analytics.controller';
import { AdminAnalyticsService } from './analytics.service';

@Module({
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService],
  exports: [AdminAnalyticsService],
})
export class AdminAnalyticsModule {}
