import { Module, forwardRef } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ComplianceModule } from '../compliance/compliance.module';

import { DisbursementController } from './disbursement.controller';
import { DisbursementService } from './disbursement.service';
import { TreasuryActorsService } from './treasury-actors.service';

@Module({
  imports: [AuditModule, forwardRef(() => ComplianceModule)],
  providers: [DisbursementService, TreasuryActorsService],
  controllers: [DisbursementController],
  exports: [DisbursementService, TreasuryActorsService],
})
export class DisbursementModule {}
