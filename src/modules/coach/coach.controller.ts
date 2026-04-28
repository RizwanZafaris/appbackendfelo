import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CoachRulesService } from './coach-rules.service';
import { CoachService } from './coach.service';
import { AskCoachDto } from './dto/ask.dto';
import { ChatCoachDto } from './dto/chat.dto';
import { CoachQuotaService } from './llm/coach-quota.service';
import { COST_RATES } from './llm/cost-model';
import { LlmCoachService } from './llm/llm-coach.service';
import { AVAILABLE_MODELS, isValidPair } from './llm/providers/registry';
import { RetrievalService } from './llm/retrieval/retrieval.service';

@ApiTags('coach')
@ApiBearerAuth()
@Controller('coach')
export class CoachController {
  constructor(
    private readonly svc: CoachService,
    private readonly rules: CoachRulesService,
    private readonly llm: LlmCoachService,
    private readonly quota: CoachQuotaService,
    private readonly retrieval: RetrievalService,
  ) {}

  // -------- Phase 1: deterministic rule engine ------------------------
  @Post('ask')
  @ApiBody({ type: AskCoachDto })
  @ApiOperation({
    summary:
      "Ask the Coach a question — answered by the rule engine using the user's real data (no LLM)",
  })
  async ask(@CurrentUser() user: RequestUser, @Body() body: AskCoachDto) {
    const prompt = body.prompt.trim();
    // Best-effort: bump the daily query counter for rate-limit visibility.
    await this.svc.incrementDailyQuery(user.id).catch(() => {});
    return this.rules.answer(user.id, prompt);
  }

  // -------- Phase 2: LLM-backed chat ----------------------------------
  @Post('chat')
  @ApiBody({ type: ChatCoachDto })
  @ApiOperation({
    summary:
      'LLM-backed Coach chat with pre/post guardrails, multi-provider routing, and tier quota',
  })
  async chat(@CurrentUser() user: RequestUser, @Body() body: ChatCoachDto) {
    const provider = body.provider ?? 'anthropic';
    const model = body.model ?? 'claude-sonnet-4-6';
    if (!isValidPair(provider, model)) {
      throw new BadRequestException(`Provider/model pair not supported: ${provider}/${model}`);
    }

    // 1. Quota gate (BEFORE the LLM call, so a refusal doesn't deduct).
    const ctx = await this.retrieval.build(user.id);
    const q = await this.quota.check(user.id, ctx.tier);
    if (q.remaining <= 0) {
      throw new HttpException(
        { error: 'quota_exceeded', message: 'Monthly quota exhausted.', quota: q },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Load history if continuing an existing conversation.
    let conversationId = body.conversationId;
    const history = conversationId ? await this.svc.getMessagesForLlm(user.id, conversationId) : [];

    // 3. Run the 3-layer pipeline.
    const out = await this.llm.run({
      userId: user.id,
      message: body.message.trim(),
      history,
      provider,
      model,
    });

    // 4. Persist + atomically reserve quota only on success. Guardrail
    //    refusals (consumesQuota=false) skip both — this is what makes
    //    the contract "a refused call never costs you a slot" hold even
    //    under concurrent traffic.
    let reservation = q;
    if (out.consumesQuota) {
      const reserved = await this.quota.tryReserve(user.id, ctx.tier);
      if (!reserved.reserved) {
        // Race: someone else used the last slot between our pre-check and
        // the LLM call. Don't persist the answer; return 429.
        throw new HttpException(
          { error: 'quota_exceeded', message: 'Monthly quota exhausted.', quota: reserved },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      reservation = reserved;

      if (!conversationId) {
        const created = await this.svc.createConversation(user.id, [
          { role: 'user', content: body.message.trim() },
          { role: 'assistant', content: out.answer },
        ]);
        conversationId = (created as { id: string }).id;
      } else {
        await this.svc.appendMessage(user.id, conversationId, {
          role: 'user',
          content: body.message.trim(),
        });
        await this.svc.appendMessage(user.id, conversationId, {
          role: 'assistant',
          content: out.answer,
        });
      }
    }

    const updatedQuota = reservation;
    return {
      conversationId,
      answer: out.answer,
      sources: out.sources,
      guardrailTriggered: out.guardrailTriggered,
      refusalCategory: out.refusalCategory,
      tokensUsed: out.tokensUsed,
      costUsd: out.costUsd,
      quotaRemaining: updatedQuota.remaining,
      promptVersion: out.promptVersion,
    };
  }

  // -------- Models + quota visibility ---------------------------------
  @Get('models')
  @ApiOperation({ summary: 'List available LLM providers and models with cost rates' })
  models() {
    return {
      models: AVAILABLE_MODELS.map((m) => {
        const r = COST_RATES[m.model];
        return {
          provider: m.provider,
          model: m.model,
          inputPerM: r?.input ?? 0,
          outputPerM: r?.output ?? 0,
        };
      }),
    };
  }

  @Get('quota')
  @ApiOperation({ summary: 'Current month quota usage for the authenticated user' })
  async myQuota(@CurrentUser() user: RequestUser) {
    const ctx = await this.retrieval.build(user.id);
    return this.quota.check(user.id, ctx.tier);
  }

  // -------- Conversation management (existing, unchanged behaviour) ---
  @Get('conversations')
  @ApiOperation({ summary: 'List Coach conversations' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.listConversations(user.id);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Fetch a single Coach conversation' })
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getConversation(user.id, id);
  }

  @Post('conversations')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { messages: { type: 'array', items: { type: 'object' } } },
    },
  })
  @ApiOperation({ summary: 'Start a new Coach conversation' })
  create(@CurrentUser() user: RequestUser, @Body() body: { messages?: unknown[] }) {
    return this.svc.createConversation(user.id, body.messages ?? []);
  }

  @Post('conversations/:id/messages')
  @ApiBody({ schema: { type: 'object' } })
  @ApiOperation({ summary: 'Append a message to a Coach conversation' })
  append(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() message: unknown,
  ) {
    return this.svc.appendMessage(user.id, id, message);
  }

  @Post('queries/increment')
  @ApiOperation({ summary: "Bump today's Coach query counter (rate-limit hook)" })
  incrementDaily(@CurrentUser() user: RequestUser) {
    return this.svc.incrementDailyQuery(user.id);
  }
}
