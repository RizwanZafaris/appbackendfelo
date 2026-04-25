import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { mfaSecrets } from '@db/schema';

import {
  decryptString,
  encryptString,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '@/common/crypto/secret-cipher';

// otplib is CJS-only — require interop is the supported pattern here.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { authenticator } = require('otplib');

const TOTP_STEP_SECONDS = 30;

/** Returns the TOTP step number for a Date (default = now). */
function totpStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Two-factor authentication, hardened for production.
 *
 *   1. Secret ENCRYPTED at rest with AES-256-GCM (see secret-cipher.ts).
 *   2. Recovery codes HASHED at rest (PBKDF2-SHA256, 600k iterations).
 *   3. TOTP REPLAY-PROTECTED: stores last accepted step; rejects re-use
 *      within the same 30-second window. (RFC 6238 §5.2)
 *
 * The plaintext TOTP secret is returned to the caller exactly once
 * during `beginEnrollment` so the user can scan a QR. The plaintext
 * recovery codes are returned exactly once during `verifyEnrollment`.
 * After that, neither leaves the database.
 */
@Injectable()
export class MfaService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async beginEnrollment(userId: string, email: string) {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(email, 'Felo', secret);

    // Lazy-load qrcode to keep cold start small.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const QRCode = require('qrcode') as typeof import('qrcode');
    const qrPngDataUrl = await QRCode.toDataURL(otpauth);

    const existing = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    if (existing && existing.verified) {
      throw new BadRequestException('2FA already enabled');
    }

    const encryptedSecret = encryptString(secret);
    if (existing) {
      await this.db
        .update(mfaSecrets)
        .set({
          secret: encryptedSecret,
          recoveryCodes: [],
          verified: false,
          lastUsedStep: null,
        })
        .where(eq(mfaSecrets.id, existing.id));
    } else {
      await this.db.insert(mfaSecrets).values({ userId, secret: encryptedSecret });
    }

    return { secret, otpauth, qrPngDataUrl };
  }

  async verifyEnrollment(userId: string, code: string) {
    const row = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    if (!row) throw new NotFoundException('Start enrollment first');

    const plaintextSecret = decryptString(row.secret);
    const trimmed = code.trim();
    if (!authenticator.check(trimmed, plaintextSecret)) {
      throw new BadRequestException('Invalid code');
    }

    const plaintextCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    const hashedCodes = plaintextCodes.map(hashRecoveryCode);

    await this.db
      .update(mfaSecrets)
      .set({
        verified: true,
        enabledAt: new Date(),
        recoveryCodes: hashedCodes,
        lastUsedStep: totpStep(),
      })
      .where(eq(mfaSecrets.id, row.id));

    return { recoveryCodes: plaintextCodes };
  }

  async verifyCode(userId: string, code: string): Promise<boolean> {
    const row = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    if (!row || !row.verified) return false;

    const trimmed = code.trim();

    // ---- TOTP path ----
    const plaintextSecret = decryptString(row.secret);
    if (authenticator.check(trimmed, plaintextSecret)) {
      const step = totpStep();
      if (row.lastUsedStep != null && step <= Number(row.lastUsedStep)) {
        return false; // replay
      }
      await this.db.update(mfaSecrets).set({ lastUsedStep: step }).where(eq(mfaSecrets.id, row.id));
      return true;
    }

    // ---- Recovery code path ----
    const hashedCodes = (row.recoveryCodes as string[]) ?? [];
    const matchIdx = hashedCodes.findIndex((h) => verifyRecoveryCode(trimmed, h));
    if (matchIdx === -1) return false;

    const remaining = hashedCodes.filter((_, i) => i !== matchIdx);
    await this.db
      .update(mfaSecrets)
      .set({ recoveryCodes: remaining })
      .where(eq(mfaSecrets.id, row.id));
    return true;
  }

  async status(userId: string) {
    const row = await this.db.query.mfaSecrets.findFirst({
      where: eq(mfaSecrets.userId, userId),
    });
    return {
      enrolled: !!row,
      verified: row?.verified ?? false,
      enabledAt: row?.enabledAt ?? null,
      remainingRecoveryCodes: row ? ((row.recoveryCodes as string[]) ?? []).length : 0,
    };
  }

  async disable(userId: string) {
    await this.db.delete(mfaSecrets).where(eq(mfaSecrets.userId, userId));
    return { ok: true };
  }
}
