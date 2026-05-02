import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from '@/common/db/db.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { KycModule } from '@/modules/kyc/kyc.module';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { TreasuryModule } from '@/modules/treasury/treasury.module';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { DisbursementModule } from '@/modules/disbursement/disbursement.module';
import { RemittanceModule } from '@/modules/remittance/remittance.module';
import { SmsModule } from '@/modules/sms/sms.module';
import config from '@/config/config';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [config], isGlobal: true }),
    DrizzleModule,
    AuthModule,
    UsersModule,
    KycModule,
    WalletModule,
    TreasuryModule,
    LedgerModule,
    DisbursementModule,
    RemittanceModule,
    SmsModule,
  ],
})
export class AppModule {}
