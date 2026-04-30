import { Module } from '@nestjs/common';
import { EngagementCampaignsController } from './engagement-campaigns.controller';
import { EngagementCampaignsService } from './engagement-campaigns.service';

@Module({
  controllers: [EngagementCampaignsController],
  providers: [EngagementCampaignsService],
  exports: [EngagementCampaignsService],
})
export class EngagementCampaignsModule {}
