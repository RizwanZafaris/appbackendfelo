import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { configFactory } from './config/config';
import { DbModule } from './common/db/db.module';
import { CommonServicesModule } from './common/services/common-services.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { SupabaseJwtGuard } from './common/guards/supabase-jwt.guard';
import { AdminJwtGuard } from './common/guards/admin-jwt.guard';
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
import { FamilyModule } from './modules/family/family.module';
import { KycModule } from './modules/kyc/kyc.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';

// S1+S2 Backend Modules
import { SmsParserModule } from './modules/sms-parser/sms-parser.module';
import { ReceiptOcrModule } from './modules/receipt-ocr/receipt-ocr.module';
import { StatementImportModule } from './modules/statement-import/statement-import.module';
import { CategorizationModule } from './modules/categorization/categorization.module';
import { FxRatesModule } from './modules/fx-rates/fx-rates.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { RemittanceProvidersModule } from './modules/remittance-providers/remittance-providers.module';

// S5 Monetization
import { TierManagementModule } from './modules/payments/tier-management.module';
import { StripeModule } from './modules/payments/stripe.module';
import { RevenueCatModule } from './modules/payments/revenuecat.module';
import { RefundModule } from './modules/payments/refund.module';
import { PaywallAbModule } from './modules/payments/paywall-ab.module';

// S6 Ops Portal
import { AdminAuthModule } from './modules/admin/admin-auth.module';
import { AdminUsersModule } from './modules/admin/admin-users.module';
import { TwoPersonApprovalModule } from './modules/admin/two-person-approval.module';
import { DashboardModule } from './modules/admin/dashboard.module';
import { TraceabilityModule } from './modules/admin/traceability.module';
import { AdminAnalyticsModule } from './modules/admin/analytics.module';
import { AuditViewerModule } from './modules/admin/audit-viewer.module';
import { FeatureFlagsAdminModule } from './modules/config/feature-flags-admin.module';

// S7 Platform Dynamic Surfaces
import { I18nModule } from './modules/i18n/i18n.module';
import { NotificationTemplatesModule } from './modules/notifications-admin/notification-templates.module';
import { AnnouncementBannersModule } from './modules/notifications-admin/announcement-banners.module';
import { EngagementCampaignsModule } from './modules/notifications-admin/engagement-campaigns.module';
import { DataRetentionModule } from './modules/admin/data-retention.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configFactory] }),
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
    CommonServicesModule,
    AuditLogModule,
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
    FamilyModule,
    KycModule,

    // S1+S2 Backend Modules
    SmsParserModule,
    ReceiptOcrModule,
    StatementImportModule,
    CategorizationModule,
    FxRatesModule,
    ComplianceModule,
    RemittanceProvidersModule,

    // S5 Monetization
    TierManagementModule,
    StripeModule,
    RevenueCatModule,
    RefundModule,
    PaywallAbModule,

    // S6 Ops Portal
    AdminAuthModule,
    AdminUsersModule,
    TwoPersonApprovalModule,
    DashboardModule,
    TraceabilityModule,
    AdminAnalyticsModule,
    AuditViewerModule,
    FeatureFlagsAdminModule,

    // S7 Platform Dynamic Surfaces
    I18nModule,
    NotificationTemplatesModule,
    AnnouncementBannersModule,
    EngagementCampaignsModule,
    DataRetentionModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseJwtGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AdminJwtGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CurrentUserMiddleware).forRoutes('*');
  }
}
