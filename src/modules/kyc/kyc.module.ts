import { Module } from '@nestjs/common';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { AdminKycController } from './admin-kyc.controller';

@Module({
  providers: [KycService],
  controllers: [KycController, AdminKycController],
  exports: [KycService],
})
export class KycModule {}
