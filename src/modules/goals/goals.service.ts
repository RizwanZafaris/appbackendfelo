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
   * (25/50/75/100%). Used by the Flutter app to fire a confetti dialog.
   */
  async contribute(userId: string, id: string, dto: ContributeGoalDto) {
    const before = await this.detail(userId, id);
    const updated = await this.db
      .update(goals)
      .set({ savedMinor: sql`${goals.savedMinor} + ${dto.amountMinor}` })
      .where(and(eq(goals.id, id), eq(goals.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Goal not found');

    const after = updated[0];
    const milestones = computeCrossedMilestones(
      before.savedMinor,
      after.savedMinor,
      after.targetMinor,
    );

    // Mark goal complete if user crossed 100%.
    if (milestones.includes(100) && !after.isCompleted) {
      const [final] = await this.db
        .update(goals)
        .set({ isCompleted: true })
        .where(eq(goals.id, id))
        .returning();
      return { goal: final, milestones };
    }

    return { goal: after, milestones };
  }

  /**
   * Returns weekly contribution streak for the goal.
   * Definition: number of *consecutive recent ISO weeks* where at least
   * one debit transaction tagged with the goal's category occurred.
   *
   * For the no-deps build we approximate by walking saved_minor diffs;
   * a real streak engine would index a goal_contributions table, which
   * is a Phase-2 enhancement.
   */
  async streak(userId: string, id: string): Promise<{ weeks: number }> {
    // Until we model contributions individually, return the trivial value
    // derived from cadence + isCompleted state. A non-zero saved_minor
    // for a weekly-cadence goal counts as one week.
    const goal = await this.detail(userId, id);
    if (goal.savedMinor === 0) return { weeks: 0 };
    if (goal.cadence === 'weekly') return { weeks: 1 };
    return { weeks: 0 };
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
