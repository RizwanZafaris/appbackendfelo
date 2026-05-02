import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { configFactory } from '@/config/config';
import { DbModule } from '@/common/db/db.module';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { RequestContextService } from '@/common/context/request-context';
import { CurrentUserMiddleware } from '@/common/middleware/current-user.middleware';

import { AccountsModule } from '@/modules/accounts/accounts.module';
import { AdminModule } from '@/modules/admin/admin.module';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';
import { AuditLogModule } from '@/modules/audit-log/audit-log.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BudgetsModule } from '@/modules/budgets/budgets.module';
import { CashEnvelopesModule } from '@/modules/cash-envelopes/cash-envelopes.module';
import { CoachModule } from '@/modules/coach/coach.module';
// SOFT-LAUNCH v1: money-movement modules (LedgerModule, TreasuryModule,
// FxRatesModule, RemittanceModule, StatementImportModule) are excluded from
// the DI graph and live under _disabled_money_modules/ until MSB licensing
// + provider corridor agreements are in place. ComplianceModule + ReceiptOcr
// are kept (compliance for AML record-keeping; receipt OCR with mocked
// adapter for capture). To re-enable money flow, restore the imports below
// and move the directories back. See LAUNCH_FLAGS.md.
import { ComplianceModule } from '@/modules/compliance/compliance.module';
import { ExportModule } from '@/modules/export/export.module';
import { FamilyModule } from '@/modules/family/family.module';
import { FeloScoresModule } from '@/modules/felo-scores/felo-scores.module';
import { GoalsModule } from '@/modules/goals/goals.module';
import { HealthModule } from '@/modules/health/health.module';
import { InsightsModule } from '@/modules/insights/insights.module';
import { InvestmentsModule } from '@/modules/investments/investments.module';
import { MonthlyCloseModule } from '@/modules/monthly-close/monthly-close.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { OnboardingModule } from '@/modules/onboarding/onboarding.module';
import { ProfilesModule } from '@/modules/profiles/profiles.module';
import { ReceiptOcrModule } from '@/modules/receipt-ocr/receipt-ocr.module';
import { RecurringBillsModule } from '@/modules/recurring-bills/recurring-bills.module';
import { ReferralsModule } from '@/modules/referrals/referrals.module';
import { RemittanceNotebookModule } from '@/modules/remittance-notebook/remittance-notebook.module';
import { ReportsModule } from '@/modules/reports/reports.module';
import { SecurityModule } from '@/modules/security/security.module';
import { SmsVerificationModule } from '@/modules/sms-verification/sms-verification.module';
import { SplitsModule } from '@/modules/splits/splits.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { TransactionsModule } from '@/modules/transactions/transactions.module';

// PII redact list for pino. Centralised so any new sensitive field has one
// place to live. Money-movement fields (amount, recipient*, IBAN, OTP, JWT)
// must never reach log aggregation in cleartext.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-id"]',
  'req.headers["x-admin-token"]',
  'req.headers["x-supabase-auth"]',
  'req.body.password',
  'req.body.passcode',
  'req.body.pin',
  'req.body.otp',
  'req.body.code',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.recipientAccount',
  'req.body.recipientPhone',
  'req.body.recipientIban',
  'req.body.iban',
  'req.body.cardNumber',
  'req.body.cvv',
  'req.body.ssn',
  'req.body.dob',
  'req.body.totpSecret',
  'req.body.recoveryCode',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.serviceRoleKey',
  '*.iban',
  '*.recipientAccount',
];

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configFactory], isGlobal: true, cache: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        serializers: {
          req(req: { method: string; url: string; id: string }) {
            return { method: req.method, url: req.url, id: req.id };
          },
          res(res: { statusCode: number }) {
            return { statusCode: res.statusCode };
          },
        },
      },
    }),
    ThrottlerModule.forRoot([
      // Per-IP defaults. Specific buckets (OTP, MFA, remittance) are
      // applied at the controller level via @Throttle.
      { name: 'default', ttl: 60_000, limit: 60 },
      { name: 'auth', ttl: 60_000, limit: 10 },
      { name: 'otp', ttl: 60 * 60_000, limit: 5 },
      { name: 'remittance', ttl: 60_000, limit: 5 },
    ]),
    ScheduleModule.forRoot(),
    DbModule,

    // Foundational
    AuthModule,
    HealthModule,
    SecurityModule,
    AuditModule,
    AuditLogModule,
    AnalyticsModule,

    // Identity / onboarding
    ProfilesModule,
    OnboardingModule,
    SmsVerificationModule,
    ReferralsModule,

    // Core finance
    AccountsModule,
    TransactionsModule,
    BudgetsModule,
    CashEnvelopesModule,
    GoalsModule,
    RecurringBillsModule,
    SplitsModule,
    InsightsModule,
    ReportsModule,
    MonthlyCloseModule,

    // Money movement — soft-launch v1 carries ONLY the manual remittance
    // notebook. LedgerModule / TreasuryModule / FxRatesModule / RemittanceModule
    // (live providers) are disabled; see _disabled_money_modules/. Re-enable
    // once MSB licensing + provider corridor agreements land.
    RemittanceNotebookModule,

    // Compliance & ops
    ComplianceModule,
    AdminModule,

    // Capture — StatementImportModule disabled until live remittance returns.
    ReceiptOcrModule,

    // Intelligence
    CoachModule,
    FeloScoresModule,

    // Monetisation & growth
    SubscriptionsModule,
    NotificationsModule,
    FamilyModule,
    InvestmentsModule,
    ExportModule,
  ],
  providers: [
    // Order matters: JWT first (sets req.user), then Roles (reads it),
    // then Throttler (per-user buckets work after auth).
    { provide: APP_GUARD, useClass: SupabaseJwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    RequestContextService,
  ],
  exports: [RequestContextService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Set Postgres session-local app.user_id for RLS, after JWT guard has
    // populated req.user. Public routes are no-ops because user is undefined.
    consumer.apply(CurrentUserMiddleware).forRoutes('*');
  }
}
