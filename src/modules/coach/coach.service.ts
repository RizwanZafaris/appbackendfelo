import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { coachConversations, coachQueries } from '@db/schema';

@Injectable()
export class CoachService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // ---- Conversations ------------------------------------------------
  listConversations(userId: string) {
    return this.db
      .select()
      .from(coachConversations)
      .where(eq(coachConversations.userId, userId))
      .orderBy(desc(coachConversations.updatedAt));
  }

  async getConversation(userId: string, id: string) {
    const row = await this.db.query.coachConversations.findFirst({
      where: and(eq(coachConversations.id, id), eq(coachConversations.userId, userId)),
    });
    if (!row) throw new NotFoundException('Conversation not found');
    return row;
  }

  async createConversation(userId: string, messages: unknown[]) {
    const inserted = await this.db
      .insert(coachConversations)
      .values({ userId, messages: messages as never })
      .returning();
    return inserted[0];
  }

  /** Returns the message history for a conversation, ready to feed into an LLM. */
  async getMessagesForLlm(
    userId: string,
    id: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const row = await this.getConversation(userId, id);
    const messages = (row as { messages: unknown }).messages;
    if (!Array.isArray(messages)) return [];
    return messages
      .filter(
        (m): m is { role: 'user' | 'assistant'; content: string } =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          (m.role === 'user' || m.role === 'assistant') &&
          'content' in m &&
          typeof (m as { content: unknown }).content === 'string',
      )
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async appendMessage(userId: string, id: string, message: unknown) {
    const updated = await this.db
      .update(coachConversations)
      .set({
        messages: sql`${coachConversations.messages} || ${JSON.stringify([message])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(coachConversations.id, id), eq(coachConversations.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Conversation not found');
    return updated[0];
  }

  // ---- Daily query quota --------------------------------------------
  async incrementDailyQuery(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const upserted = await this.db
      .insert(coachQueries)
      .values({ userId, queryDate: today, queryCount: 1 })
      .onConflictDoUpdate({
        target: [coachQueries.userId, coachQueries.queryDate],
        set: { queryCount: sql`${coachQueries.queryCount} + 1` },
      })
      .returning();
    return upserted[0];
  }
}
