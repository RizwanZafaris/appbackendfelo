import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { goals } from '@db/schema';

import { ContributeGoalDto, CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

const MILESTONE_THRESHOLDS = [25, 50, 75, 100] as const;

/** Returns the milestone percentages crossed when going from `before` to `after`. */
function computeCrossedMilestones(
  beforeMinor: number,
  afterMinor: number,
  targetMinor: number,
): number[] {
  if (targetMinor <= 0) return [];
  const before = (beforeMinor / targetMinor) * 100;
  const after = (afterMinor / targetMinor) * 100;
  return MILESTONE_THRESHOLDS.filter((m) => before < m && after >= m);
}

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

  /**
   * Add a contribution and report any milestones the user just crossed
   * (25/50/75/100%). Atomic: a single UPDATE returns both old and new
   * `saved_minor` so concurrent contributions can't double-fire the
   * same milestone.
   */
  async contribute(userId: string, id: string, dto: ContributeGoalDto) {
    type Row = {
      id: string;
      userId: string;
      savedMinor: number | string;
      previousSavedMinor: number | string;
      targetMinor: number | string;
      isCompleted: boolean;
    };

    const result = await this.db.execute(sql`
      UPDATE ${goals}
         SET saved_minor = saved_minor + ${dto.amountMinor}
       WHERE id = ${id} AND user_id = ${userId}
       RETURNING
         id,
         user_id        AS "userId",
         saved_minor    AS "savedMinor",
         saved_minor - ${dto.amountMinor} AS "previousSavedMinor",
         target_minor   AS "targetMinor",
         is_completed   AS "isCompleted"
    `);
    const rows = result as unknown as Row[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Goal not found');

    const previous = Number(row.previousSavedMinor);
    const current = Number(row.savedMinor);
    const target = Number(row.targetMinor);
    const milestones = computeCrossedMilestones(previous, current, target);

    // Mark complete on 100% — same UPDATE keeps userId in WHERE for
    // defense-in-depth even though the row was already filtered.
    if (milestones.includes(100) && !row.isCompleted) {
      await this.db
        .update(goals)
        .set({ isCompleted: true })
        .where(and(eq(goals.id, id), eq(goals.userId, userId)));
    }

    const goal = await this.detail(userId, id);
    return { goal, milestones };
  }

  /**
   * Weekly contribution streak — Phase-1 STUB.
   *
   * A real implementation needs a `goal_contributions` table indexed
   * by (goal_id, week). Until that ships, we return null + a status
   * marker so the Flutter UI can hide the badge instead of showing a
   * fake "1 week" streak.
   */
  async streak(
    userId: string,
    id: string,
  ): Promise<{ weeks: number | null; status: 'unimplemented' | 'ok' }> {
    await this.detail(userId, id); // ownership check
    return { weeks: null, status: 'unimplemented' };
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
