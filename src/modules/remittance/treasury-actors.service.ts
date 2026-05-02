import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DatabaseService } from '@/common/database.service';
import { treasuryActors } from '@db/schema';

/**
 * Resolves a Supabase user UUID to a stable integer treasury_actors.id.
 *
 * Replaces the previous in-controller `actorIdFromUuid` 32-bit string-hash
 * implementation which collided across users and produced cross-user IDOR
 * on disbursement orders. This service guarantees one-to-one mapping by
 * persisting the UUID and using a UNIQUE index.
 *
 * Concurrency: race-safe via INSERT … ON CONFLICT (user_uuid) DO UPDATE.
 */
@Injectable()
export class TreasuryActorsService {
  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Resolve, creating the row if absent. Returns both the integer id and
   * the KYC tier so callers can avoid a second lookup.
   */
  async resolve(userUuid: string, email?: string): Promise<{ actorId: number; kycTier: string }> {
    if (!userUuid) {
      throw new Error('TreasuryActorsService.resolve: userUuid required');
    }

    const existing = await this.dbService.db
      .select({ id: treasuryActors.id, kycTier: treasuryActors.kycTier })
      .from(treasuryActors)
      .where(eq(treasuryActors.userUuid, userUuid))
      .limit(1);

    if (existing.length > 0) {
      return { actorId: existing[0].id, kycTier: existing[0].kycTier };
    }

    // Synthesize a per-user email when the caller doesn't have one — the
    // column is NOT NULL UNIQUE on a legacy schema. The placeholder is
    // overwritten the moment the user completes KYC profile sync.
    const placeholderEmail = email ?? `${userUuid}@user.felo.invalid`;

    const inserted = await this.dbService.db
      .insert(treasuryActors)
      .values({
        userUuid,
        email: placeholderEmail,
        kycTier: 'none',
        status: 'active',
      } as never)
      .onConflictDoUpdate({
        target: treasuryActors.userUuid,
        set: { updatedAt: sql`now()` },
      })
      .returning({ id: treasuryActors.id, kycTier: treasuryActors.kycTier });

    if (!inserted.length) {
      throw new Error('TreasuryActorsService.resolve: insert returned no row');
    }
    return { actorId: inserted[0].id, kycTier: inserted[0].kycTier };
  }
}
