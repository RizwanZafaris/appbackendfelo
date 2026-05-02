import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';

import { DatabaseService } from '@/common/database.service';
import { launchReadinessItems } from '@db/schema';

export type LaunchStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
const VALID_STATUSES: ReadonlyArray<LaunchStatus> = ['pending', 'in_progress', 'done', 'blocked'];

export interface UpdateStatusInput {
  status: LaunchStatus;
  notes?: string;
  rotationDueAt?: Date;
}

@Injectable()
export class LaunchReadinessService {
  constructor(private readonly db: DatabaseService) {}

  async list(filters: { category?: string; status?: LaunchStatus; blocking?: boolean }) {
    const conditions = [];
    if (filters.category) conditions.push(eq(launchReadinessItems.category, filters.category));
    if (filters.status) conditions.push(eq(launchReadinessItems.status, filters.status));
    if (filters.blocking !== undefined) {
      conditions.push(eq(launchReadinessItems.blocking, filters.blocking));
    }

    const rows = await this.db.db
      .select()
      .from(launchReadinessItems)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(launchReadinessItems.category), asc(launchReadinessItems.id));
    return rows;
  }

  async summary() {
    const rows = await this.db.db
      .select({
        category: launchReadinessItems.category,
        status: launchReadinessItems.status,
        blocking: launchReadinessItems.blocking,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(launchReadinessItems)
      .groupBy(launchReadinessItems.category, launchReadinessItems.status, launchReadinessItems.blocking);

    const blockingPending = await this.db.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(launchReadinessItems)
      .where(
        and(
          eq(launchReadinessItems.blocking, true),
          sql`${launchReadinessItems.status} != 'done'`,
        ),
      );

    return {
      breakdown: rows,
      blockingPending: blockingPending[0]?.count ?? 0,
      readyToLaunch: (blockingPending[0]?.count ?? 0) === 0,
    };
  }

  async setStatus(
    id: number,
    actorUuid: string,
    input: UpdateStatusInput,
  ): Promise<typeof launchReadinessItems.$inferSelect> {
    if (!VALID_STATUSES.includes(input.status)) {
      throw new ConflictException(`Invalid status: ${input.status}`);
    }

    const existing = await this.db.db
      .select()
      .from(launchReadinessItems)
      .where(eq(launchReadinessItems.id, id))
      .limit(1);
    if (!existing.length) throw new NotFoundException(`Item ${id} not found`);

    const previous = existing[0];

    const [updated] = await this.db.db
      .update(launchReadinessItems)
      .set({
        status: input.status,
        notes: input.notes ?? previous.notes,
        rotationDueAt: input.rotationDueAt ?? previous.rotationDueAt,
        checkedBy: actorUuid as never,
        checkedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(launchReadinessItems.id, id))
      .returning();

    // The dedicated launch-readiness audit row is written by the
    // before-update trigger in 013_soft_launch.sql. Keeping the
    // application-side audit out of the strict-enum action list to avoid
    // expanding the enum for this single subsystem; the trigger row is
    // structurally identical (audit_log table) and enriched with
    // jsonb payload.

    return updated;
  }
}
