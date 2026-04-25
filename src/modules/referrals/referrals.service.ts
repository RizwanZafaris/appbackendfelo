import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { profiles, referralCodes, referrals } from '@db/schema';

const REWARD_MINOR = 1000; // 10.00 in account currency
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function generateCode(length = 7): string {
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

@Injectable()
export class ReferralsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Get-or-create the user's referral code. */
  async getOrCreateMyCode(userId: string) {
    const existing = await this.db.query.referralCodes.findFirst({
      where: eq(referralCodes.ownerUserId, userId),
    });
    if (existing) return existing;

    // Generate until unique (collisions rare with 32^7 = 34B codes).
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateCode();
      try {
        const inserted = await this.db
          .insert(referralCodes)
          .values({ ownerUserId: userId, code })
          .returning();
        return inserted[0];
      } catch (err) {
        // Retry only on PG unique violation (23505); surface other errors.
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: unknown }).code === '23505'
        ) {
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to allocate unique referral code');
  }

  async listMyReferrals(userId: string) {
    return this.db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerUserId, userId))
      .orderBy(desc(referrals.createdAt));
  }

  async stats(userId: string) {
    const rows = await this.db
      .select({ status: referrals.status, count: count() })
      .from(referrals)
      .where(eq(referrals.referrerUserId, userId))
      .groupBy(referrals.status);

    const summary = { pending: 0, qualified: 0, rewarded: 0 };
    let totalRewardMinor = 0;
    for (const r of rows) {
      if (r.status === 'pending') summary.pending = Number(r.count);
      if (r.status === 'qualified') summary.qualified = Number(r.count);
      if (r.status === 'rewarded') summary.rewarded = Number(r.count);
    }

    const rewardedRows = await this.db
      .select({ amt: referrals.rewardMinor })
      .from(referrals)
      .where(and(eq(referrals.referrerUserId, userId), eq(referrals.status, 'rewarded')));
    for (const r of rewardedRows) {
      totalRewardMinor += r.amt ?? 0;
    }

    return { summary, totalRewardMinor };
  }

  /**
   * Apply a referral code to the current user (the "referred" user).
   * Idempotent — fails if user already has a referral.
   */
  async redeem(userId: string, codeText: string) {
    const trimmed = codeText.trim().toUpperCase();
    if (trimmed.length < 5) throw new BadRequestException('Invalid code');

    const code = await this.db.query.referralCodes.findFirst({
      where: eq(referralCodes.code, trimmed),
    });
    if (!code) throw new NotFoundException('Code not found');
    if (code.ownerUserId === userId) {
      throw new BadRequestException('Cannot redeem your own code');
    }

    const existing = await this.db.query.referrals.findFirst({
      where: eq(referrals.referredUserId, userId),
    });
    if (existing) {
      throw new ConflictException('You already used a referral code');
    }

    const me = await this.db.query.profiles.findFirst({
      where: eq(profiles.id, userId),
    });
    const currency = me?.currency ?? 'CAD';

    // Race-safe insert: the UNIQUE index on `referred_user_id` is the
    // ultimate guard. Translate PG 23505 → 409 instead of leaking 500.
    try {
      const inserted = await this.db
        .insert(referrals)
        .values({
          codeId: code.id,
          referrerUserId: code.ownerUserId,
          referredUserId: userId,
          rewardMinor: REWARD_MINOR,
          rewardCurrency: currency,
          status: 'pending',
        })
        .returning();
      return inserted[0];
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === '23505'
      ) {
        throw new ConflictException('You already used a referral code');
      }
      throw err;
    }
  }

  /**
   * Mark a referral as qualified.
   *
   * In production this is intended to be a server-side event triggered
   * by a real milestone (e.g. first transaction, KYC complete). The
   * endpoint is restricted to the **referrer** so the referred user
   * cannot self-qualify and farm rewards.
   */
  async qualify(referralId: string, actingUserId: string) {
    const ref = await this.db.query.referrals.findFirst({
      where: eq(referrals.id, referralId),
    });
    if (!ref) throw new NotFoundException('Referral not found');
    if (ref.referrerUserId !== actingUserId) {
      throw new BadRequestException('Only the referrer can qualify a referral');
    }
    const updated = await this.db
      .update(referrals)
      .set({ status: 'qualified', qualifiedAt: new Date() })
      .where(eq(referrals.id, referralId))
      .returning();
    return updated[0];
  }
}
