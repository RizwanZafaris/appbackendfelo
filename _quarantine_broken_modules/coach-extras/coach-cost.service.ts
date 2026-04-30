import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { coachConversationCosts } from '@db/schema';

export interface CostRecordInput {
  conversationId: string;
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

@Injectable()
export class CoachCostService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async record(input: CostRecordInput) {
    const [row] = await this.db
      .insert(coachConversationCosts)
      .values({
        conversationId: input.conversationId,
        userId: input.userId,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: String(input.costUsd),
      })
      .returning();
    return row;
  }

  async costsByConversation(conversationId: string) {
    return this.db
      .select()
      .from(coachConversationCosts)
      .where(eq(coachConversationCosts.conversationId, conversationId))
      .orderBy(desc(coachConversationCosts.createdAt));
  }

  async costsByUser(userId: string, limit = 100) {
    return this.db
      .select()
      .from(coachConversationCosts)
      .where(eq(coachConversationCosts.userId, userId))
      .orderBy(desc(coachConversationCosts.createdAt))
      .limit(limit);
  }

  async totalCostByUser(userId: string) {
    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${coachConversationCosts.costUsd}), 0)` })
      .from(coachConversationCosts)
      .where(eq(coachConversationCosts.userId, userId));
    return { totalUsd: Number(rows[0]?.total ?? 0) };
  }

  async dailyCostSummary(days = 30) {
    return this.db
      .select({
        date: sql<string>`DATE(${coachConversationCosts.createdAt})`,
        totalUsd: sql<number>`COALESCE(SUM(${coachConversationCosts.costUsd}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${coachConversationCosts.inputTokens} + ${coachConversationCosts.outputTokens}), 0)`,
        conversationCount: sql<number>`COUNT(DISTINCT ${coachConversationCosts.conversationId})`,
      })
      .from(coachConversationCosts)
      .where(
        sql`${coachConversationCosts.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`,
      )
      .groupBy(sql`DATE(${coachConversationCosts.createdAt})`)
      .orderBy(sql`DATE(${coachConversationCosts.createdAt}) DESC`);
  }
}
