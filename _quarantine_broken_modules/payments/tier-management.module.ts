import { Module } from '@nestjs/common';
import { TierManagementController } from './tier-management.controller';
import { TierManagementService } from './tier-management.service';

@Module({
  controllers: [TierManagementController],
  providers: [TierManagementService],
  exports: [TierManagementService],
})
export class TierManagementModule {}
