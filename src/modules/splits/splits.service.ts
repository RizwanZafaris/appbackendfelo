import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { splitParticipants, splits } from '@db/schema';

import { CreateSplitDto, ParticipantInputDto, UpdateSplitDto } from './dto/split.dto';

@Injectable()
export class SplitsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * List the user's splits with full participant arrays embedded.
   *
   * Cost: 2 round-trips (splits + participants IN-list), not N+1.
   * Participants are grouped client-side.
   *
   * Backwards-compat: legacy `participantCount` and `paidCount` aggregates
   * are still returned (computed from the embedded participants) so old
   * Flutter consumers keep working unchanged.
   *
   * Tenant scoping: the participant IN-list is constructed from split
   * ids that already passed `splits.owner_user_id = userId`, so we never
   * leak participants across tenants. RLS on `split_participants`
   * provides defense-in-depth.
   */
  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(splits)
      .where(eq(splits.ownerUserId, userId))
      .orderBy(desc(splits.createdAt));

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const participants = await this.db
      .select()
      .from(splitParticipants)
      .where(inArray(splitParticipants.splitId, ids))
      .orderBy(splitParticipants.createdAt);

    type Participant = (typeof participants)[number];
    const byId = new Map<
      string,
      { participants: Participant[]; paidCount: number }
    >();
    for (const id of ids) {
      byId.set(id, { participants: [], paidCount: 0 });
    }
    for (const p of participants) {
      const bucket = byId.get(p.splitId);
      if (!bucket) continue; // defense-in-depth: drop orphan rows
      bucket.participants.push(p);
      if (p.paid) bucket.paidCount += 1;
    }

    return rows.map((r) => {
      const bucket = byId.get(r.id);
      return {
        ...r,
        participants: bucket?.participants ?? [],
        participantCount: bucket?.participants.length ?? 0,
        paidCount: bucket?.paidCount ?? 0,
      };
    });
  }

  async detail(userId: string, id: string) {
    const split = await this.db.query.splits.findFirst({
      where: and(eq(splits.id, id), eq(splits.ownerUserId, userId)),
    });
    if (!split) throw new NotFoundException('Split not found');

    const participants = await this.db
      .select()
      .from(splitParticipants)
      .where(eq(splitParticipants.splitId, id))
      .orderBy(splitParticipants.createdAt);

    return { ...split, participants };
  }

  async create(userId: string, dto: CreateSplitDto) {
    if (dto.participants && dto.participants.length > 0) {
      const sumShares = dto.participants.reduce((acc, p) => acc + p.shareMinor, 0);
      if (sumShares !== dto.totalMinor) {
        throw new BadRequestException(
          `Participant shares (${sumShares}) must sum to total (${dto.totalMinor})`,
        );
      }
    }

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(splits)
        .values({
          ownerUserId: userId,
          name: dto.name,
          currency: dto.currency.toUpperCase(),
          totalMinor: dto.totalMinor,
          notes: dto.notes ?? null,
        })
        .returning();

      if (dto.participants && dto.participants.length > 0) {
        await tx.insert(splitParticipants).values(
          dto.participants.map((p) => ({
            splitId: created.id,
            userId: p.userId ?? null,
            displayName: p.displayName,
            shareMinor: p.shareMinor,
          })),
        );
      }
      return created;
    });
  }

  /**
   * Add a participant. Validates that the new participant's share does
   * not push the share-sum over the split's totalMinor invariant.
   */
  async addParticipant(userId: string, splitId: string, p: ParticipantInputDto) {
    return this.db.transaction(async (tx) => {
      const [split] = await tx
        .select()
        .from(splits)
        .where(and(eq(splits.id, splitId), eq(splits.ownerUserId, userId)))
        .limit(1);
      if (!split) throw new NotFoundException('Split not found');

      const sumRow = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${splitParticipants.shareMinor}), 0)::bigint`,
        })
        .from(splitParticipants)
        .where(eq(splitParticipants.splitId, splitId));
      const currentSum = Number(sumRow[0]?.total ?? 0);

      if (currentSum + p.shareMinor > split.totalMinor) {
        throw new BadRequestException(
          `Adding share ${p.shareMinor} would exceed total ${split.totalMinor} ` +
            `(current sum ${currentSum})`,
        );
      }

      const [inserted] = await tx
        .insert(splitParticipants)
        .values({
          splitId,
          userId: p.userId ?? null,
          displayName: p.displayName,
          shareMinor: p.shareMinor,
        })
        .returning();
      return inserted;
    });
  }

  async setParticipantPaid(userId: string, splitId: string, participantId: string, paid: boolean) {
    const split = await this.db.query.splits.findFirst({
      where: and(eq(splits.id, splitId), eq(splits.ownerUserId, userId)),
    });
    if (!split) throw new NotFoundException('Split not found');

    const updated = await this.db
      .update(splitParticipants)
      .set({ paid })
      .where(and(eq(splitParticipants.id, participantId), eq(splitParticipants.splitId, splitId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Participant not found');
    return updated[0];
  }

  /**
   * Update a split. If `totalMinor` is being changed, validates that the
   * new value still equals Σ participant shares (invariant preserved).
   */
  async update(userId: string, id: string, dto: UpdateSplitDto) {
    return this.db.transaction(async (tx) => {
      if (dto.totalMinor != null) {
        const sumRow = await tx
          .select({
            total: sql<number>`COALESCE(SUM(${splitParticipants.shareMinor}), 0)::bigint`,
          })
          .from(splitParticipants)
          .where(eq(splitParticipants.splitId, id));
        const currentSum = Number(sumRow[0]?.total ?? 0);
        if (currentSum > 0 && dto.totalMinor !== currentSum) {
          throw new BadRequestException(
            `New total ${dto.totalMinor} must equal current participant share sum ${currentSum}`,
          );
        }
      }

      const [updated] = await tx
        .update(splits)
        .set({
          name: dto.name,
          currency: dto.currency?.toUpperCase(),
          totalMinor: dto.totalMinor,
          notes: dto.notes,
          isSettled: dto.isSettled,
        })
        .where(and(eq(splits.id, id), eq(splits.ownerUserId, userId)))
        .returning();
      if (!updated) throw new NotFoundException('Split not found');
      return updated;
    });
  }

  /**
   * Mark whole split settled + every participant paid — atomically.
   */
  async settle(userId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(splits)
        .set({ isSettled: true })
        .where(and(eq(splits.id, id), eq(splits.ownerUserId, userId)))
        .returning();
      if (!updated) throw new NotFoundException('Split not found');

      await tx
        .update(splitParticipants)
        .set({ paid: true })
        .where(eq(splitParticipants.splitId, id));
      return updated;
    });
  }

  async remove(userId: string, id: string) {
    const removed = await this.db
      .delete(splits)
      .where(and(eq(splits.id, id), eq(splits.ownerUserId, userId)))
      .returning();
    if (!removed[0]) throw new NotFoundException('Split not found');
    return { ok: true };
  }
}
