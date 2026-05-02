import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { DisbursementModule } from './disbursement.module';
import { RemittanceController } from './remittance.controller';
import { RemittanceService } from './remittance.service';
import { RemittanceAdminController } from './remittance.admin.controller';
import { RemittanceWebhookGuard } from './remittance-webhook.guard';
import { TreasuryActorsService } from './treasury-actors.service';
import { PayoutProviderFactory } from './providers/provider-factory.service';
import {
  PaymobProvider,
  SamsaraProvider,
  KhaltiProvider,
  SafepayRaastProvider,
  EightBProvider,
  HrcUblProvider,
  HabibMetroProvider,
} from './providers/payout.providers';

@Module({
  imports: [AuditModule, ComplianceModule, DisbursementModule],
  controllers: [RemittanceController, RemittanceAdminController],
  providers: [
    RemittanceService,
    PayoutProviderFactory,
    RemittanceWebhookGuard,
    TreasuryActorsService,
    PaymobProvider,
    SamsaraProvider,
    KhaltiProvider,
    SafepayRaastProvider,
    EightBProvider,
    HrcUblProvider,
    HabibMetroProvider,
  ],
  exports: [
    RemittanceService,
    PayoutProviderFactory,
    TreasuryActorsService,
    DisbursementModule,
  ],
})
export class RemittanceModule {}
