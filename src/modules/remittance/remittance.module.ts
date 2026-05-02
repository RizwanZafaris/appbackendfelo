import { Module } from '@nestjs/common';
import { RemittanceController } from './remittance.controller';
import { RemittanceService } from './remittance.service';
import { RemittanceAdminController } from './remittance.admin.controller';
import { RemittanceReceiptService } from './remittance-receipt.service';
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
    RemittanceReceiptService,
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
    UcbProvider,
    DhakaBankProvider,
    AblProvider,
    FaysalBankProvider,
  ],
  exports: [RemittanceService, PayoutProviderFactory, RemittanceReceiptService],
})
export class RemittanceModule {}
