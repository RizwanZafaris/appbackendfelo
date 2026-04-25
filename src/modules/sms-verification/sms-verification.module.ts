import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DbModule } from '@/common/db/db.module';

import { ConsoleLoggerSmsProvider } from './providers/console-logger.provider';
import {
  SMS_PROVIDERS,
  type SmsProvider,
} from './providers/sms-provider.interface';
import { TwilioSmsProvider } from './providers/twilio.provider';
import { SmsController } from './sms.controller';
import { SmsProviderRegistry } from './sms-provider.registry';
import { SmsService } from './sms.service';

/**
 * SMS verification module — D-005 + D-006 + D-007.
 *
 * Strategy pattern: each adapter self-registers. The factory below
 * filters out inactive ones (missing env vars) so the registry only
 * sees live providers.
 *
 * Adding a new corridor adapter (PK Veevotech, IN MSG91, etc.):
 *   1. Implement SmsProvider in providers/<vendor>.provider.ts
 *   2. Add to providers list + factory inject below
 *   3. No other code changes anywhere
 */
@Module({
  imports: [DbModule, ConfigModule],
  controllers: [SmsController],
  providers: [
    TwilioSmsProvider,
    ConsoleLoggerSmsProvider,
    SmsProviderRegistry,
    SmsService,
    {
      provide: SMS_PROVIDERS,
      useFactory: (
        twilio: TwilioSmsProvider,
        consoleLogger: ConsoleLoggerSmsProvider,
        cfg: ConfigService,
      ): SmsProvider[] => {
        const providers: SmsProvider[] = [];
        // Concrete vendor adapters — order matters; first active wins for
        // a given country.
        if (twilio.active) providers.push(twilio);
        // ConsoleLogger registered iff explicitly opted in OR no real
        // provider is active (final-fallback safety net).
        const devLoggerForced =
          cfg.get<string>('SMS_DEV_LOGGER') === 'true';
        if (devLoggerForced || providers.length === 0) {
          providers.push(consoleLogger);
        }
        return providers;
      },
      inject: [TwilioSmsProvider, ConsoleLoggerSmsProvider, ConfigService],
    },
  ],
  exports: [SmsService],
})
export class SmsVerificationModule {}
