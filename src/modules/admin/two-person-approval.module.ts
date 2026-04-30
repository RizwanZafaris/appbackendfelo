import { Module } from '@nestjs/common';
import { TwoPersonApprovalController } from './two-person-approval.controller';
import { TwoPersonApprovalService } from './two-person-approval.service';

@Module({
  controllers: [TwoPersonApprovalController],
  providers: [TwoPersonApprovalService],
  exports: [TwoPersonApprovalService],
})
export class TwoPersonApprovalModule {}
