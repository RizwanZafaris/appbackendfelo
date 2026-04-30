import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { coachConversations } from '@db/schema';

import { CoachCostService } from './coach-cost.service';
import { CoachPromptService } from './coach-prompt.service';
import { GuardrailTripService } from './guardrail-trip.service';
import { LlmCoachService } from './llm/llm-coach.service';

export interface ChatInput {
  message: string;
  conversationId?: string;
  provider?: string;
  model?: string;
}

export interface ChatOutput {
  conversationId: string;
  answer: string;
  sources: unknown[];
  guardrailTriggered: boolean;
  refusalCategory?: string;
  tokensUsed: number;
  costUsd: number;
  quotaRemaining: number;
  promptVersion: string;
  isCanary: boolean;
}

const HISTORY_CAP = 20;

@Injectable()
export class CoachChatService {
  private readonly log = new Logger(CoachChatService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly llm: LlmCoachService,
    private readonly promptSvc: CoachPromptService,
    private readonly costSvc: CoachCostService,
    private readonly tripSvc: GuardrailTripService,
  ) {}

  async chat(userId: string, input: ChatInput): Promise<ChatOutput> {
    const resolved = await this.promptSvc.resolve(userId);

    // Load or create conversation
    let conversationId = input.conversationId;
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (conversationId) {
      history = await this.getMessagesForLlm(userId, conversationId);
    }

    // Run LLM
    const llmInput = {
      userId,
      message: input.message.trim(),
      history,
      provider: input.provider ?? 'anthropic',
      model: input.model ?? 'claude-sonnet-4-6',
    };

    const result = await this.llm.run(llmInput);

    // Persist conversation
    if (!conversationId) {
      const created = await this.createConversation(userId, [
        { role: 'user', content: input.message.trim() },
        { role: 'assistant', content: result.answer },
      ]);
      conversationId = created.id;
    } else {
      await this.appendMessage(userId, conversationId, {
        role: 'user',
        content: input.message.trim(),
      });
      await this.appendMessage(userId, conversationId, {
        role: 'assistant',
        content: result.answer,
      });
    }

    // Track cost
    if (result.consumesQuota) {
      await this.costSvc.record({
        conversationId,
        userId,
        provider: llmInput.provider,
        model: llmInput.model,
        inputTokens: result.inputTokens ?? result.tokensUsed / 2,
        outputTokens: result.outputTokens ?? result.tokensUsed / 2,
        costUsd: result.costUsd,
      });
    }

    // Log guardrail trips
    if (result.guardrailTriggered && result.refusalCategory) {
      await this.tripSvc.record({
        actorId: userId,
        layer: 'pre',
        category: result.refusalCategory,
        messagePreview: input.message.slice(0, 120),
        conversationId,
      });
    }

    return {
      conversationId,
      answer: result.answer,
      sources: result.sources,
      guardrailTriggered: result.guardrailTriggered,
      refusalCategory: result.refusalCategory,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
      quotaRemaining: 0, // Quota managed separately
      promptVersion: resolved.version,
      isCanary: resolved.isCanary,
    };
  }

  async listConversations(userId: string) {
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

  /** Get conversation with PII-redacted preview for admin viewing. */
  async getConversationRedacted(id: string) {
    const row = await this.db.query.coachConversations.findFirst({
      where: eq(coachConversations.id, id),
    });
    if (!row) throw new NotFoundException('Conversation not found');

    const messages = (row as unknown as { messages: Array<{ role: string; content: string }> }).messages ?? [];
    const redacted = messages.map((m) => ({
      role: m.role,
      preview: m.content.slice(0, 200) + (m.content.length > 200 ? '...' : ''),
      hasNumbers: /\d{4,}/.test(m.content),
    }));

    return {
      id: row.id,
      userId: row.userId,
      messageCount: messages.length,
      updatedAt: row.updatedAt,
      messages: redacted,
    };
  }

  // ---- Internal helpers ----

  private async getMessagesForLlm(
    userId: string,
    id: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const row = await this.getConversation(userId, id);
    const messages = (row as unknown as { messages: unknown[] }).messages;
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
      .slice(-HISTORY_CAP)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  private async createConversation(userId: string, messages: unknown[]) {
    const inserted = await this.db
      .insert(coachConversations)
      .values({ userId, messages: messages as never })
      .returning();
    return inserted[0];
  }

  private async appendMessage(userId: string, id: string, message: unknown) {
    await this.db
      .update(coachConversations)
      .set({
        messages: sql`${coachConversations.messages} || ${JSON.stringify([message])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(coachConversations.id, id), eq(coachConversations.userId, userId)));
  }
}
