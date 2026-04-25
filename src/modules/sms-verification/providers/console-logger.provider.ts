import { Injectable, Logger } from '@nestjs/common';

import type {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from './sms-provider.interface';

/**
 * Dev-mode SMS provider. Always active. Logs the OTP code to stdout
 * instead of sending an SMS. Safe to register in any environment that
 * sets `SMS_DEV_LOGGER=true`. Universal fallback when no real provider
 * is registered for a country.
 *
 * **Never use in production.** The real provider chain ALWAYS supersedes
 * this one when at least one is registered for the destination country.
 */
@Injectable()
export class ConsoleLoggerSmsProvider implements SmsProvider {
  readonly name = 'console_logger';
  /** Empty `serves` means "fallback only" — picked iff nothing else matches. */
  readonly serves: readonly string[] = [];
  readonly active = true;

  private readonly logger = new Logger(ConsoleLoggerSmsProvider.name);

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    this.logger.log(
      `[DEV SMS] ${params.phoneE164} (locale=${params.locale ?? 'en'}) — OTP=${params.otpCode}`,
    );
    return { ok: true, providerMessageId: `dev-${Date.now()}` };
  }
}
