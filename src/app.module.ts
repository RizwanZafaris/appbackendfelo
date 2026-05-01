import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { configFactory } from './config/config';
import { DbModule } from './common/db/db.module';
import { SupabaseJwtGuard } from './common/guards/supabase-jwt.guard';
import { CurrentUserMiddleware } from './common/middleware/current-user.middleware';

import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { GoalsModule } from './modules/goals/goals.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { FeloScoresModule } from './modules/felo-scores/felo-scores.module';
import { RecurringBillsModule } from './modules/recurring-bills/recurring-bills.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { CoachModule } from './modules/coach/coach.module';
import { SecurityModule } from './modules/security/security.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { SplitsModule } from './modules/splits/splits.module';
import { InvestmentsModule } from './modules/investments/investments.module';
import { InsightsModule } from './modules/insights/insights.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SmsVerificationModule } from './modules/sms-verification/sms-verification.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CashEnvelopesModule } from './modules/cash-envelopes/cash-envelopes.module';
import { RemittanceNotebookModule } from './modules/remittance-notebook/remittance-notebook.module';
import { MonthlyCloseModule } from './modules/monthly-close/monthly-close.module';
import { ExportModule } from './modules/export/export.module';
import { AdminModule } from './modules/admin/admin.module';
import { FxRatesModule } from './modules/fx-rates/fx-rates.module';
import { AuditModule } from './modules/audit/audit.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { TreasuryModule } from './modules/treasury/treasury.module';
import { DisbursementModule } from './modules/remittance/disbursement.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { FamilyModule } from './modules/family/family.module';
import { ReceiptOcrModule } from './modules/receipt-ocr/receipt-ocr.module';
import { StatementImportModule } from './modules/statement-import/statement-import.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configFactory] }),
    // Per-IP rate limit. 100 req/min default; auth endpoints can override
    // tighter via @Throttle({ ttl, limit }) on the controller method.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 100 },
      { name: 'long', ttl: 3_600_000, limit: 1_000 },
    ]),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.firebaseIdToken',
          ],
          remove: true,
        },
        level: process.env.LOG_LEVEL ?? 'info',
      },
    }),
    DbModule,
    AuthModule,
    HealthModule,
    ProfilesModule,
    AccountsModule,
    BudgetsModule,
    GoalsModule,
    TransactionsModule,
    FeloScoresModule,
    RecurringBillsModule,
    SubscriptionsModule,
    CoachModule,
    SecurityModule,
    ReferralsModule,
    SplitsModule,
    InvestmentsModule,
    InsightsModule,
    NotificationsModule,
    AnalyticsModule,
    OnboardingModule,
    SmsVerificationModule,
    ReportsModule,
    CashEnvelopesModule,
    RemittanceNotebookModule,
    MonthlyCloseModule,
    ExportModule,
    AdminModule,
    FxRatesModule,
    AuditModule,
    LedgerModule,
    TreasuryModule,
    DisbursementModule,
    AuditLogModule,
    FamilyModule,
    ReceiptOcrModule,
    StatementImportModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseJwtGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CurrentUserMiddleware).forRoutes('*');
  }
}
