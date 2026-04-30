import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, desc, gte, lte, sql, like, or } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { auditLogs, type AuditLog } from '@db/schema';

export interface AuditSearchFilters {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: string;
  to?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditViewerService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Full-text search across audit logs. */
  async search(filters: AuditSearchFilters): Promise<{ items: AuditLog[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions = [];

    if (filters.actorId) conditions.push(eq(auditLogs.actorId, filters.actorId));
    if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
    if (filters.resourceType) conditions.push(eq(auditLogs.resourceType, filters.resourceType));
    if (filters.resourceId) conditions.push(eq(auditLogs.resourceId, filters.resourceId));
    if (filters.from) conditions.push(gte(auditLogs.createdAt, new Date(filters.from)));
    if (filters.to) conditions.push(lte(auditLogs.createdAt, new Date(filters.to)));
    if (filters.query) {
      const q = `%${filters.query}%`;
      conditions.push(
        or(
          like(auditLogs.action, q),
          like(auditLogs.resourceType, q),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs)
      .where(where);

    return {
      items,
      total: countResult[0]?.count ?? 0,
    };
  }

  /** Get before/after diff for a specific audit entry. */
  async getDiff(id: string) {
    const log = await this.db.query.auditLogs.findFirst({
      where: eq(auditLogs.id, id),
    });
    if (!log) throw new NotFoundException('Audit entry not found');

    return {
      id: log.id,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      before: log.before,
      after: log.after,
      actorId: log.actorId,
      actorType: log.actorType,
      createdAt: log.createdAt,
      diff: this.computeDiff(log.before as Record<string, unknown> | null, log.after as Record<string, unknown> | null),
    };
  }

  /** Get all audit entries for a specific actor. */
  async getActorReport(actorId: string, limit = 100): Promise<AuditLog[]> {
    return this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, actorId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  /** Detect anomalies in audit patterns. */
  async detectAnomalies() {
    // Find unusual patterns: bulk actions, off-hours access, repeated failures
    const bulkActions = await this.db.execute(sql`
      SELECT actor_id, action, resource_type, COUNT(*) as action_count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY actor_id, action, resource_type
      HAVING COUNT(*) > 50
      ORDER BY action_count DESC
    `);

    const offHoursAccess = await this.db.execute(sql`
      SELECT actor_id, COUNT(*) as access_count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND EXTRACT(HOUR FROM created_at) BETWEEN 0 AND 5
      GROUP BY actor_id
      HAVING COUNT(*) > 10
      ORDER BY access_count DESC
    `);

    const repeatedFailures = await this.db.execute(sql`
      SELECT actor_id, action, COUNT(*) as failure_count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND (action LIKE '%fail%' OR action LIKE '%reject%' OR action LIKE '%error%')
      GROUP BY actor_id, action
      HAVING COUNT(*) > 10
      ORDER BY failure_count DESC
    `);

    return {
      bulkActions: bulkActions.rows ?? [],
      offHoursAccess: offHoursAccess.rows ?? [],
      repeatedFailures: repeatedFailures.rows ?? [],
      generatedAt: new Date().toISOString(),
    };
  }

  private computeDiff(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Array<{ field: string; old: unknown; new: unknown }> {
    const allKeys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    const diff: Array<{ field: string; old: unknown; new: unknown }> = [];

    for (const key of allKeys) {
      const oldVal = before?.[key];
      const newVal = after?.[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diff.push({ field: key, old: oldVal, new: newVal });
      }
    }

    return diff;
  }
}
