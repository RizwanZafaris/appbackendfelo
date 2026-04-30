import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { KYC_PROVIDER } from '@/integrations/kyc/kyc-provider.port';
import { MockKycAdapter } from '@/integrations/kyc/mock-kyc.adapter';
import { OnfidoAdapter } from '@/integrations/kyc/onfido.adapter';
import { AuditLogModule } from '@/modules/audit-log/audit-log.module';

import { KycAdminController } from './kyc-admin.controller';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

function providerFactory(cfg: ConfigService) {
  const provider = cfg.get<string>('KYC_PROVIDER');
  if (provider === 'onfido') return new OnfidoAdapter(cfg);
  return new MockKycAdapter();
}

@Module({
  imports: [AuditLogModule],
  controllers: [KycController, KycAdminController],
  providers: [
    KycService,
    {
      provide: KYC_PROVIDER,
      inject: [ConfigService],
      useFactory: providerFactory,
    },
  ],
  exports: [KycService],
})
export class KycModule {}
