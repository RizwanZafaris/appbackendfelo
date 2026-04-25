import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseJwtGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CurrentUserMiddleware).forRoutes('*');
  }
}
