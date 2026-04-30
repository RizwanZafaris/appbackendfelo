import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { DisbursementController } from './disbursement.controller';
import { DisbursementService } from './disbursement.service';

@Module({
  imports: [AuditModule],
  providers: [DisbursementService],
  controllers: [DisbursementController],
  exports: [DisbursementService],
})
export class DisbursementModule {}
