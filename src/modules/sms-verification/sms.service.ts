import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';

import type { SmsProvider } from './providers/sms-provider.interface';
import { SmsProviderRegistry } from './sms-provider.registry';

/**
 * OTP send + verify orchestration. Persists challenge in
 * `phone_otp_challenges` (created in 006) with PBKDF2-hashed code,
 * 5-min TTL, max 3 attempts, replay-protected.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly OTP_TTL_MS = 5 * 60 * 1000; // D-011: 5 minutes
  private readonly MAX_ATTEMPTS = 3;             // D-011

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly registry: SmsProviderRegistry,
  ) {}

  async sendOtp(params: {
    phoneE164: string;
    locale?: string;
    ipDetectedCountry?: string;
  }): Promise<{
    challenge_id: string;
    expires_at: string;
    provider: string;
    masked_phone: string;
  }> {
    // D-006 routing: IP-detected country first, E.164 prefix fallback.
    const routingCountry =
      params.ipDetectedCountry ??
      SmsProviderRegistry.dialCodeToCountry(params.phoneE164);
    const provider = this.registry.for(routingCountry);

    if (!provider) {
      throw new Error(
        `No active SMS provider for ${routingCountry ?? 'unknown country'}. Configure SMS_TWILIO_* or SMS_DEV_LOGGER=true.`,
      );
    }

    // Generate + hash the code. Don't store the plaintext.
    const code = SmsService.generateOtpCode();
    const codeHash = SmsService.hashOtp(code, params.phoneE164);
    const expiresAt = new Date(Date.now() + this.OTP_TTL_MS).toISOString();

    const insertResult = (await this.db.execute(sql`
      INSERT INTO public.phone_otp_challenges (
        phone_e164, code_hash, expires_at, attempts,
        provider_name, ip_detected_country
      ) VALUES (
        ${params.phoneE164},
        ${codeHash},
        ${expiresAt}::timestamptz,
        0,
        ${provider.name},
        ${params.ipDetectedCountry ?? null}
      )
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    if (!insertResult[0]) {
      throw new Error('Failed to insert phone_otp_challenge');
    }

    // Fire the SMS. Provider failures are returned to the caller.
    const result = await provider.send({
      phoneE164: params.phoneE164,
      otpCode: code,
      locale: params.locale,
    });

    if (!result.ok) {
      this.logger.error(
        `SMS send failed via ${provider.name}: ${result.error?.code}/${result.error?.message}`,
      );
      // Don't surface internal codes to the caller; throw a generic.
      throw new Error('sms_send_failed');
    }

    return {
      challenge_id: insertResult[0].id,
      expires_at: expiresAt,
      provider: provider.name,
      masked_phone: SmsService.maskPhone(params.phoneE164),
    };
  }

  async verifyOtp(params: {
    challengeId: string;
    code: string;
  }): Promise<{ ok: boolean; reason?: string }> {
    const rows = (await this.db.execute(sql`
      SELECT id, phone_e164, code_hash, expires_at, attempts, used_at
      FROM public.phone_otp_challenges
      WHERE id = ${params.challengeId}::uuid
      LIMIT 1
    `)) as unknown as Array<{
      id: string;
      phone_e164: string;
      code_hash: string;
      expires_at: string;
      attempts: number;
      used_at: string | null;
    }>;

    const row = rows[0];
    if (!row) return { ok: false, reason: 'challenge_not_found' };
    if (row.used_at) return { ok: false, reason: 'already_used' };
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    if (row.attempts >= this.MAX_ATTEMPTS) {
      return { ok: false, reason: 'max_attempts' };
    }

    // Increment attempts BEFORE hash compare to prevent timing-side attacks.
    await this.db.execute(sql`
      UPDATE public.phone_otp_challenges
         SET attempts = attempts + 1
       WHERE id = ${params.challengeId}::uuid
    `);

    const expected = SmsService.hashOtp(params.code, row.phone_e164);
    if (expected !== row.code_hash) {
      const remainingAfterIncrement = this.MAX_ATTEMPTS - (row.attempts + 1);
      return {
        ok: false,
        reason:
          remainingAfterIncrement > 0
            ? 'wrong_code'
            : 'wrong_code_max_attempts_reached',
      };
    }

    // Mark used to prevent replay (D-011).
    await this.db.execute(sql`
      UPDATE public.phone_otp_challenges
         SET used_at = NOW()
       WHERE id = ${params.challengeId}::uuid
    `);

    return { ok: true };
  }

  // ------- helpers -------

  private static generateOtpCode(): string {
    // 6 digits, zero-padded
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(6, '0');
  }

  private static hashOtp(code: string, phoneE164: string): string {
    // PBKDF2-SHA256 with phone-as-salt — short codes are weak; the salt
    // ties the hash to a specific phone number so a leaked hash can't
    // be brute-forced against arbitrary phones.
    return crypto
      .pbkdf2Sync(code, phoneE164, 100_000, 32, 'sha256')
      .toString('hex');
  }

  private static maskPhone(phoneE164: string): string {
    if (phoneE164.length <= 6) return phoneE164;
    const head = phoneE164.slice(0, 4);
    const tail = phoneE164.slice(-2);
    const middleLen = phoneE164.length - 6;
    return head + '*'.repeat(middleLen) + tail;
  }
}
