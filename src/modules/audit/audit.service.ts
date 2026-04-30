import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/common/database.service';
import { auditActionEnum, treasuryAuditLogs } from '@db/schema';
import { eq, and, desc, sql, lt, gt } from 'drizzle-orm';
import { CursorPaginationParams, normalizeLimit, encodeCursor, decodeCursor, PaginatedResult } from '@/common/pagination';

export interface AuditRecord {
  actorId?: number;
  action: typeof auditActionEnum.enumValues[number];
  entityType: string;
  entityId?: number;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly dbService: DatabaseService) {}

  async record(record: AuditRecord): Promise<void> {
    await this.dbService.db.insert(treasuryAuditLogs).values({
      actorId: record.actorId ?? null,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId ?? null,
      payload: record.payload ?? null,
      ipAddress: record.ipAddress ?? null,
      userAgent: record.userAgent ?? null,
    });
  }

  async findByEntity(entityType: string, entityId: number, params: CursorPaginationParams): Promise<PaginatedResult<typeof treasuryAuditLogs.$inferSelect>> {
    const limit = normalizeLimit(params.limit);
    const cursor = params.cursor ? Number(decodeCursor(params.cursor)) : null;
    const direction = params.direction ?? 'next';

    const conditions = [eq(treasuryAuditLogs.entityType, entityType), eq(treasuryAuditLogs.entityId, entityId)];
    if (cursor) {
      if (direction === 'next') {
        conditions.push(lt(treasuryAuditLogs.id, cursor));
      } else {
        conditions.push(gt(treasuryAuditLogs.id, cursor));
      }
    }

    const rows = await this.dbService.db
      .select()
      .from(treasuryAuditLogs)
      .where(and(...conditions))
      .orderBy(direction === 'next' ? desc(treasuryAuditLogs.id) : treasuryAuditLogs.id)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null;
    const prevCursor = cursor ? encodeCursor(cursor) : null;

    return { data, nextCursor, prevCursor, hasMore };
  }
}
