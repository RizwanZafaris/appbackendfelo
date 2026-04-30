import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
