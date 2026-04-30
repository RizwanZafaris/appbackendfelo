import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { auditLogs } from '@db/schema';

export interface AuditEntryInput {
  actorId: string;
  entityType: string;
  entityId?: string;
  operation: 'create' | 'update' | 'delete' | 'read';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface CursorPaginationInput {
  cursor?: string;
  limit?: number;
}

export interface CursorPaginationResult<T> {
  items: T[];
  nextCursor?: string;
}

@Injectable()
export class AuditLogService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async record(input: AuditEntryInput) {
    const [row] = await this.db
      .insert(auditLogs)
      .values({
        actorUserId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        operation: input.operation,
        beforeState: input.before ?? null,
        afterState: input.after ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning();
    return row;
  }

  async findByActor(
    actorId: string,
    opts: CursorPaginationInput = {},
  ): Promise<CursorPaginationResult<typeof auditLogs.$inferSelect>> {
    const limit = opts.limit ?? 50;

    const conditions = [eq(auditLogs.actorUserId, actorId)];
    if (opts.cursor) {
      conditions.push(lt(auditLogs.createdAt, new Date(opts.cursor)));
    }

    const items = await this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit + 1);

    let nextCursor: string | undefined;
    if (items.length > limit) {
      const last = items[limit - 1];
      nextCursor = last?.createdAt.toISOString();
      items.length = limit;
    }

    return { items, nextCursor };
  }

  async findByEntity(
    entityType: string,
    entityId: string,
    opts: CursorPaginationInput = {},
  ): Promise<CursorPaginationResult<typeof auditLogs.$inferSelect>> {
    const limit = opts.limit ?? 50;

    const conditions = [eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)];
    if (opts.cursor) {
      conditions.push(lt(auditLogs.createdAt, new Date(opts.cursor)));
    }

    const items = await this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit + 1);

    let nextCursor: string | undefined;
    if (items.length > limit) {
      const last = items[limit - 1];
      nextCursor = last?.createdAt.toISOString();
      items.length = limit;
    }

    return { items, nextCursor };
  }
}
