import { Module } from '@nestjs/common';

import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { SanctionsService } from './sanctions.service';

@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, SanctionsService],
  exports: [ComplianceService, SanctionsService],
})
export class ComplianceModule {}
