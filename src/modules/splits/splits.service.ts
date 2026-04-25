import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, sum } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { splitParticipants, splits } from '@db/schema';

import { CreateSplitDto, ParticipantInputDto, UpdateSplitDto } from './dto/split.dto';

@Injectable()
export class SplitsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(splits)
      .where(eq(splits.ownerUserId, userId))
      .orderBy(desc(splits.createdAt));

    // Attach participant counts in a single query
    const counts = await this.db
      .select({
        splitId: splitParticipants.splitId,
        total: count(),
        paid: sum(
          // count only paid rows
          // drizzle doesn't have a `case` helper here, so do two passes
          splitParticipants.id,
        ),
      })
      .from(splitParticipants);
    const cIdx = new Map(counts.map((c) => [c.splitId, c.total]));
    return rows.map((r) => ({ ...r, participantCount: cIdx.get(r.id) ?? 0 }));
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

  async addParticipant(userId: string, splitId: string, p: ParticipantInputDto) {
    // Check ownership
    const split = await this.db.query.splits.findFirst({
      where: and(eq(splits.id, splitId), eq(splits.ownerUserId, userId)),
    });
    if (!split) throw new NotFoundException('Split not found');

    const [inserted] = await this.db
      .insert(splitParticipants)
      .values({
        splitId,
        userId: p.userId ?? null,
        displayName: p.displayName,
        shareMinor: p.shareMinor,
      })
      .returning();
    return inserted;
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

  async update(userId: string, id: string, dto: UpdateSplitDto) {
    const updated = await this.db
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
    if (!updated[0]) throw new NotFoundException('Split not found');
    return updated[0];
  }

  async settle(userId: string, id: string) {
    const updated = await this.db
      .update(splits)
      .set({ isSettled: true })
      .where(and(eq(splits.id, id), eq(splits.ownerUserId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Split not found');

    await this.db
      .update(splitParticipants)
      .set({ paid: true })
      .where(eq(splitParticipants.splitId, id));
    return updated[0];
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
