import { Module } from '@nestjs/common';
import { RemittanceController } from './remittance.controller';
import { RemittanceService } from './remittance.service';
import { RemittanceAdminController } from './remittance.admin.controller';
import { PayoutProviderFactory } from './providers/provider-factory.service';
import {
  PaymobProvider,
  SamsaraProvider,
  KhaltiProvider,
  SafepayRaastProvider,
  EightBProvider,
  HrcUblProvider,
  HabibMetroProvider,
  Digit9Provider,
  MtbProvider,
  AgraniBankProvider,
  BracBankProvider,
  PrimeBankProvider,
  StandardBankProvider,
  UcbProvider,
  DhakaBankProvider,
  AblProvider,
  FaysalBankProvider,
} from './providers/payout.providers';

@Module({
  controllers: [RemittanceController, RemittanceAdminController],
  providers: [
    RemittanceService,
    PayoutProviderFactory,
    PaymobProvider,
    SamsaraProvider,
    KhaltiProvider,
    SafepayRaastProvider,
    EightBProvider,
    HrcUblProvider,
    HabibMetroProvider,
    Digit9Provider,
    MtbProvider,
    AgraniBankProvider,
    BracBankProvider,
    PrimeBankProvider,
    StandardBankProvider,
    AblProvider,
    FaysalBankProvider,
  ],
  exports: [RemittanceService, PayoutProviderFactory],
})
export class RemittanceModule {}
