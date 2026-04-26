import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';

/**
 * **OTP attempt rate-limiter.** Audit §2:
 *  - Max 3 failed verifications per identity
 *  - 30-min cooldown after 3rd failure
 *  - Reset counter on successful verification
 *  - State persisted (survives server restart) — `public.otp_attempts`
 *
 * The OTP code itself is generated/stored by `phone_otp_challenges`
 * (existing table). This service only manages the per-identity counter.
 *
 * Identity = phone E.164 (SMS channel) OR lowercased email (email channel).
 * NEVER log the OTP code itself; we only log identity + attempt count.
 */
export interface OtpRateLimitState {
  inCooldown: boolean;
  cooldownUntil: Date | null;
  failCount: number;
  attemptsRemaining: number;
}

@Injectable()
export class OtpAttemptService {
  private readonly logger = new Logger(OtpAttemptService.name);
  private readonly MAX_ATTEMPTS = 3;
  private readonly COOLDOWN_MS = 30 * 60 * 1000;

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Returns the current rate-limit state for `identity`. Call this
   * BEFORE generating or verifying an OTP. If `inCooldown=true` the
   * caller MUST refuse the operation with a user-facing message.
   */
  async checkState(identity: string, channel: 'sms' | 'email'): Promise<OtpRateLimitState> {
    const norm = this.normalize(identity);
    const rows = await this.db.execute<{
      fail_count: number;
      cooldown_until: Date | null;
    }>(sql`
      SELECT fail_count, cooldown_until FROM public.otp_attempts
       WHERE identity = ${norm} AND channel = ${channel}
       LIMIT 1
    `);
    const row = (rows as unknown as Array<{ fail_count: number; cooldown_until: Date | null }>)[0];
    if (!row) {
      return {
        inCooldown: false,
        cooldownUntil: null,
        failCount: 0,
        attemptsRemaining: this.MAX_ATTEMPTS,
      };
    }
    const cd = row.cooldown_until ? new Date(row.cooldown_until) : null;
    const inCooldown = cd !== null && cd.getTime() > Date.now();
    return {
      inCooldown,
      cooldownUntil: inCooldown ? cd : null,
      failCount: row.fail_count,
      attemptsRemaining: Math.max(0, this.MAX_ATTEMPTS - row.fail_count),
    };
  }

  /**
   * Record a failed verification. Returns the updated state. If this
   * call pushed `fail_count` to MAX_ATTEMPTS, the cooldown is set.
   */
  async recordFailure(identity: string, channel: 'sms' | 'email'): Promise<OtpRateLimitState> {
    const norm = this.normalize(identity);
    // Atomic upsert with conditional cooldown set.
    const rows = await this.db.execute<{
      fail_count: number;
      cooldown_until: Date | null;
    }>(sql`
      INSERT INTO public.otp_attempts (identity, channel, fail_count, last_attempt_at)
      VALUES (${norm}, ${channel}, 1, NOW())
      ON CONFLICT (identity) DO UPDATE SET
        fail_count      = public.otp_attempts.fail_count + 1,
        last_attempt_at = NOW(),
        cooldown_until  = CASE
          WHEN public.otp_attempts.fail_count + 1 >= ${this.MAX_ATTEMPTS}
            THEN NOW() + (${this.COOLDOWN_MS} || ' milliseconds')::INTERVAL
          ELSE public.otp_attempts.cooldown_until
        END
      RETURNING fail_count, cooldown_until
    `);
    const r = (rows as unknown as Array<{ fail_count: number; cooldown_until: Date | null }>)[0];
    const cd = r?.cooldown_until ? new Date(r.cooldown_until) : null;
    const inCooldown = cd !== null && cd.getTime() > Date.now();
    this.logger.warn(
      `OTP fail: identity=${this.maskIdentity(norm)} count=${r.fail_count} cooldown=${inCooldown}`,
    );
    return {
      inCooldown,
      cooldownUntil: inCooldown ? cd : null,
      failCount: r.fail_count,
      attemptsRemaining: Math.max(0, this.MAX_ATTEMPTS - r.fail_count),
    };
  }

  /** Wipe state on successful verification. */
  async recordSuccess(identity: string, channel: 'sms' | 'email'): Promise<void> {
    const norm = this.normalize(identity);
    await this.db.execute(sql`
      DELETE FROM public.otp_attempts
       WHERE identity = ${norm} AND channel = ${channel}
    `);
  }

  // ───── helpers ─────

  private normalize(identity: string): string {
    // Email → lowercase trim. Phone → strip whitespace, ensure leading +.
    const trimmed = identity.trim();
    if (trimmed.includes('@')) return trimmed.toLowerCase();
    const digits = trimmed.replace(/[\s\-()]/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  }

  /** Mask identity for logging — show only first 3 + last 2 chars. */
  private maskIdentity(id: string): string {
    if (id.length <= 6) return '***';
    return `${id.slice(0, 3)}***${id.slice(-2)}`;
  }
}
