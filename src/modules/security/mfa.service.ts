import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
// otplib is CJS-only — `import * as` interop works under our NestJS config.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { authenticator } = require('otplib');
import * as QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { mfaSecrets } from '@db/schema';

/**
 * Pure-Dart-and-Postgres TOTP 2FA — no external vendor.
 * Implements RFC 6238 via `otplib`, persisted in mfa_secrets.
 */
@Injectable()
export class MfaService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Begin enrollment — generates a fresh secret + QR code. The user scans
   * it with Google Authenticator/Authy then verifies a 6-digit code.
   */
  async beginEnrollment(userId: string, email: string) {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(email, 'Felo', secret);
    const qrPngDataUrl = await QRCode.toDataURL(otpauth);

    // Upsert — replacing any unverified secret if the user retried.
    const existing = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    if (existing && existing.verified) {
      throw new BadRequestException('2FA already enabled');
    }
    if (existing) {
      await this.db
        .update(mfaSecrets)
        .set({ secret, recoveryCodes: [], verified: false })
        .where(eq(mfaSecrets.id, existing.id));
    } else {
      await this.db.insert(mfaSecrets).values({ userId, secret });
    }

    return { secret, otpauth, qrPngDataUrl };
  }

  /**
   * Confirm enrollment by submitting the 6-digit code shown in the
   * authenticator app. On success, generates 8 single-use recovery codes.
   */
  async verifyEnrollment(userId: string, code: string) {
    const row = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    if (!row) throw new NotFoundException('Start enrollment first');
    const ok = authenticator.check(code.trim(), row.secret);
    if (!ok) throw new BadRequestException('Invalid code');

    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));

    await this.db
      .update(mfaSecrets)
      .set({
        verified: true,
        enabledAt: new Date(),
        recoveryCodes,
      })
      .where(eq(mfaSecrets.id, row.id));

    return { recoveryCodes };
  }

  /**
   * Verify a TOTP or recovery code at sign-in. Used by clients for the
   * second factor after Supabase Auth password challenge.
   * Returns true if accepted (and consumes a recovery code if used).
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const row = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    if (!row || !row.verified) return false;

    const trimmed = code.trim();
    if (authenticator.check(trimmed, row.secret)) return true;

    // Recovery code path
    const codes = (row.recoveryCodes as string[]).map((c) => c.toLowerCase());
    if (codes.includes(trimmed.toLowerCase())) {
      const remaining = codes.filter((c) => c !== trimmed.toLowerCase());
      await this.db
        .update(mfaSecrets)
        .set({ recoveryCodes: remaining })
        .where(eq(mfaSecrets.id, row.id));
      return true;
    }
    return false;
  }

  async status(userId: string) {
    const row = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    return {
      enrolled: !!row,
      verified: row?.verified ?? false,
      enabledAt: row?.enabledAt ?? null,
      remainingRecoveryCodes: row ? (row.recoveryCodes as string[]).length : 0,
    };
  }

  async disable(userId: string) {
    await this.db.delete(mfaSecrets).where(eq(mfaSecrets.userId, userId));
    return { ok: true };
  }
}
