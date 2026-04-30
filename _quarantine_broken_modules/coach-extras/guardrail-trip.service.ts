import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { auditLogs } from '@db/schema';

export interface GuardrailTripRecord {
  id: string;
  userId: string;
  conversationId?: string;
  layer: 'pre' | 'post';
  category: string;
  messagePreview: string;
  createdAt: Date;
}

@Injectable()
export class GuardrailTripService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async record(input: {
    actorId: string;
    layer: 'pre' | 'post';
    category: string;
    messagePreview: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.db.insert(auditLogs).values({
      actorId: input.actorId,
      entityType: 'coach_guardrail',
      operation: 'create',
      entityId: input.conversationId ?? null,
      metadata: {
        layer: input.layer,
        category: input.category,
        messagePreview: input.messagePreview,
        ...input.metadata,
      },
    });
  }

  async listTrips(opts: { limit?: number; layer?: string } = {}) {
    const limit = opts.limit ?? 100;

    const conditions = [eq(auditLogs.entityType, 'coach_guardrail')];

    return this.db
      .select()
      .from(auditLogs)
      .where(conditions[0])
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async tripStats(days = 7) {
    const rows = await this.db
      .select({
        category: sql<string>`${auditLogs.metadata}->>'category'`,
        layer: sql<string>`${auditLogs.metadata}->>'layer'`,
        count: sql<number>`COUNT(*)`,
      })
      .from(auditLogs)
      .where(
        sql`${auditLogs.entityType} = 'coach_guardrail' AND ${auditLogs.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`,
      )
      .groupBy(
        sql`${auditLogs.metadata}->>'category'`,
        sql`${auditLogs.metadata}->>'layer'`,
      );

    return rows;
  }
}
