import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { goals } from '@db/schema';

import { ContributeGoalDto, CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

@Injectable()
export class GoalsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  list(userId: string) {
    return this.db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(desc(goals.createdAt));
  }

  async detail(userId: string, id: string) {
    const row = await this.db.query.goals.findFirst({
      where: and(eq(goals.id, id), eq(goals.userId, userId)),
    });
    if (!row) throw new NotFoundException('Goal not found');
    return row;
  }

  async create(userId: string, dto: CreateGoalDto) {
    const inserted = await this.db
      .insert(goals)
      .values({
        userId,
        name: dto.name,
        currency: dto.currency.toUpperCase(),
        targetMinor: dto.targetMinor,
        savedMinor: dto.savedMinor ?? 0,
        targetDate: dto.targetDate ?? null,
        cadence: dto.cadence,
        shared: dto.shared ?? false,
      })
      .returning();
    return inserted[0];
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    const updated = await this.db
      .update(goals)
      .set({
        name: dto.name,
        currency: dto.currency?.toUpperCase(),
        targetMinor: dto.targetMinor,
        savedMinor: dto.savedMinor,
        targetDate: dto.targetDate,
        cadence: dto.cadence,
        shared: dto.shared,
      })
      .where(and(eq(goals.id, id), eq(goals.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Goal not found');
    return updated[0];
  }

  async contribute(userId: string, id: string, dto: ContributeGoalDto) {
    const updated = await this.db
      .update(goals)
      .set({ savedMinor: sql`${goals.savedMinor} + ${dto.amountMinor}` })
      .where(and(eq(goals.id, id), eq(goals.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Goal not found');
    return updated[0];
  }

  async remove(userId: string, id: string) {
    const removed = await this.db
      .delete(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, userId)))
      .returning();
    if (!removed[0]) throw new NotFoundException('Goal not found');
    return { ok: true };
  }
}
