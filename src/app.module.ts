import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DbModule } from '@/common/db/db.module';
import { CircuitBreakerModule } from '@/common/circuit-breaker/circuit-breaker.module';
import { PrometheusModule } from '@/common/metrics/prometheus.module';
import { ComplianceModule } from '@/common/compliance/compliance.module';
import { HealthModule } from '@/common/health/health.module';
import { AuditLogModule } from '@/common/audit/audit-log.module';
import { SystemModule } from '@/common/system/system.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { KycModule } from '@/modules/kyc/kyc.module';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { TreasuryModule } from '@/modules/treasury/treasury.module';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { DisbursementModule } from '@/modules/disbursement/disbursement.module';
import { RemittanceModule } from '@/modules/remittance/remittance.module';
import { SmsModule } from '@/modules/sms/sms.module';
import { RequestIdInterceptor } from '@/common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { configFactory } from '@/config/config';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configFactory], isGlobal: true }),
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: 60000,
      limit: 100,
    }, {
      name: 'auth',
      ttl: 60000,
      limit: 10,
    }, {
      name: 'otp',
      ttl: 300000,
      limit: 5,
    }]),
    DbModule,
    AuthModule,
    UsersModule,
    KycModule,
    WalletModule,
    TreasuryModule,
    LedgerModule,
    DisbursementModule,
    RemittanceModule,
    SmsModule,
    CircuitBreakerModule,
    PrometheusModule,
    ComplianceModule,
    HealthModule,
    AuditLogModule,
    SystemModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
