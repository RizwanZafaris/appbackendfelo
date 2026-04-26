import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from './sms-provider.interface';

/**
 * Twilio Programmable SMS adapter — universal fallback for any corridor
 * that doesn't have a dedicated local vendor (D-007).
 *
 * Mechanism rule: if `SMS_TWILIO_ACCOUNT_SID` + `SMS_TWILIO_AUTH_TOKEN`
 * + `SMS_TWILIO_FROM` are set, this provider activates and registers
 * itself for the broad set of countries Twilio reaches. If any are
 * missing, `active = false` — the registry skips it.
 *
 * Required env vars:
 *   SMS_TWILIO_ACCOUNT_SID   — your Twilio Account SID (ACxxxxx)
 *   SMS_TWILIO_AUTH_TOKEN    — auth token from Twilio console
 *   SMS_TWILIO_FROM           — 'FELO' (alphanumeric sender ID, where allowed)
 *                              or your Twilio number (+1xxx...)
 */
@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  /**
   * Twilio reaches most countries — list the diaspora corridors first
   * (where Twilio is the sensible default per D-005), plus everything
   * else as a fallback layer.
   */
  readonly serves: readonly string[] = [
    'CA',
    'GB',
    'US',
    'AU',
    'NZ',
    'DE',
    'FR',
    'IE',
  ];

  private readonly logger = new Logger(TwilioSmsProvider.name);
  private readonly accountSid: string | undefined;
  private readonly authToken: string | undefined;
  private readonly fromIdentity: string | undefined;

  constructor(cfg: ConfigService) {
    this.accountSid = cfg.get<string>('SMS_TWILIO_ACCOUNT_SID');
    this.authToken = cfg.get<string>('SMS_TWILIO_AUTH_TOKEN');
    this.fromIdentity = cfg.get<string>('SMS_TWILIO_FROM');
    this.logger.log(
      this.active
        ? `TwilioSmsProvider active — from=${this.fromIdentity}`
        : 'TwilioSmsProvider inactive — set SMS_TWILIO_ACCOUNT_SID + SMS_TWILIO_AUTH_TOKEN + SMS_TWILIO_FROM to activate.',
    );
  }

  get active(): boolean {
    return !!this.accountSid && !!this.authToken && !!this.fromIdentity;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    if (!this.active) {
      return {
        ok: false,
        error: { code: 'inactive', message: 'twilio_credentials_missing' },
      };
    }

    try {
      // Twilio REST API: POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Messages.json
      const body = new URLSearchParams({
        To: params.phoneE164,
        From: params.senderId ?? this.fromIdentity!,
        Body: this.buildSmsBody(params),
      });

      const auth = Buffer.from(
        `${this.accountSid}:${this.authToken}`,
      ).toString('base64');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          ok: false,
          error: {
            code: `twilio_${res.status}`,
            message: errText.slice(0, 200),
          },
        };
      }

      const json = (await res.json()) as { sid?: string };
      return { ok: true, providerMessageId: json.sid };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'twilio_fetch_failed',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private buildSmsBody(params: SmsSendParams): string {
    // Locale-aware copy lives in journey_strings (D-029). For E12 we
    // ship a fixed English template; phase-7-style template lookup is
    // a Stage 7 follow-up.
    return `Your Felo code is ${params.otpCode}. Valid for 5 minutes.`;
  }
}
