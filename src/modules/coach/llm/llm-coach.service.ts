import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GuardrailsService } from './guardrails/guardrails.service';
import { RefusalCategory } from './guardrails/refusal-categories';
import {
  COACH_PROMPT_VERSION,
  COACH_SYSTEM_PROMPT,
  POST_GUARDRAIL_CORRECTION_PROMPT,
  REFUSAL_TEMPLATES,
  SAFE_FALLBACK,
} from './prompts';
import { LlmProvider } from './providers/base';
import { ProviderRegistry } from './providers/registry';
import {
  CoachContext,
  compressContext,
  contextSources,
  CoachSource,
} from './retrieval/coach-context';
import { RetrievalService } from './retrieval/retrieval.service';

export interface LlmCoachInput {
  userId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  provider: string;
  model: string;
}

export interface LlmCoachOutput {
  answer: string;
  sources: CoachSource[];
  guardrailTriggered: boolean;
  refusalCategory?: RefusalCategory;
  tokensUsed: number;
  costUsd: number;
  promptVersion: string;
  /** True if quota should be deducted by the caller. False on guardrail refusals. */
  consumesQuota: boolean;
}

const HISTORY_CAP = 20;

/**
 * Three-layer pipeline: pre-guardrail → retrieval+LLM → post-guardrail.
 *
 * Quota is enforced by the caller (CoachController) so a failed guardrail
 * call does not consume the user's monthly quota.
 */
@Injectable()
export class LlmCoachService {
  private readonly log = new Logger(LlmCoachService.name);

  constructor(
    private readonly cfg: ConfigService,
    private readonly retrieval: RetrievalService,
    private readonly guardrails: GuardrailsService,
    private readonly providers: ProviderRegistry,
  ) {}

  async run(input: LlmCoachInput): Promise<LlmCoachOutput> {
    const provider = this.providers.get(input.provider);
    const ctx = await this.retrieval.build(input.userId);

    // ---------- Layer 1: pre-guardrail -------------------------------
    const classify = this.haikuClassifier();
    const pre = await this.guardrails.pre(input.message, classify);
    if (pre.triggered) {
      return {
        answer: pre.refusalText ?? (pre.category ? REFUSAL_TEMPLATES[pre.category] : SAFE_FALLBACK),
        sources: [],
        guardrailTriggered: true,
        refusalCategory: pre.category,
        tokensUsed: 0,
        costUsd: 0,
        promptVersion: COACH_PROMPT_VERSION,
        consumesQuota: false,
      };
    }

    // ---------- Layer 2: retrieval + LLM call ------------------------
    const ctxStr = compressContext(ctx);
    const system = `${COACH_SYSTEM_PROMPT}\n\nUSER_CONTEXT:\n${ctxStr}`;
    const messages = [
      ...input.history.slice(-HISTORY_CAP),
      { role: 'user' as const, content: input.message },
    ];

    const result = await provider.complete({
      systemPrompt: system,
      messages,
      model: input.model,
    });

    // ---------- Layer 3: post-guardrail ------------------------------
    const post = this.guardrails.post(result.text, ctx);
    if (post.triggered) {
      // Retry once with a correction prompt if it's the grounding case.
      if (post.category === RefusalCategory.UNGROUNDED_NUMBER) {
        const retry = await this.tryCorrection(provider, input, system, result.text, ctx, ctxStr);
        if (retry) return retry;
      }
      return {
        answer: SAFE_FALLBACK,
        sources: [],
        guardrailTriggered: true,
        refusalCategory: post.category,
        tokensUsed: result.inputTokens + result.outputTokens,
        costUsd: result.costUsd,
        promptVersion: COACH_PROMPT_VERSION,
        consumesQuota: false,
      };
    }

    return {
      answer: result.text,
      sources: contextSources(ctx),
      guardrailTriggered: false,
      tokensUsed: result.inputTokens + result.outputTokens,
      costUsd: result.costUsd,
      promptVersion: COACH_PROMPT_VERSION,
      consumesQuota: true,
    };
  }

  private async tryCorrection(
    provider: LlmProvider,
    input: LlmCoachInput,
    system: string,
    firstAnswer: string,
    ctx: CoachContext,
    ctxStr: string,
  ): Promise<LlmCoachOutput | null> {
    try {
      const correctionMsg = POST_GUARDRAIL_CORRECTION_PROMPT(ctxStr, firstAnswer);
      const retry = await provider.complete({
        systemPrompt: system,
        messages: [
          ...input.history.slice(-HISTORY_CAP),
          { role: 'user', content: input.message },
          { role: 'assistant', content: firstAnswer },
          { role: 'user', content: correctionMsg },
        ],
        model: input.model,
      });
      if (this.guardrails.post(retry.text, ctx).triggered) return null;
      return {
        answer: retry.text,
        sources: contextSources(ctx),
        guardrailTriggered: false,
        tokensUsed: retry.inputTokens + retry.outputTokens,
        costUsd: retry.costUsd,
        promptVersion: COACH_PROMPT_VERSION,
        consumesQuota: true,
      };
    } catch (e) {
      this.log.warn(`post-guardrail correction failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Cheap classifier used by pre-guardrail. Defaults to Haiku, falls back
   * to ALLOW on outage so a classifier failure doesn't block legitimate
   * users (post-guardrail still runs).
   */
  private haikuClassifier(): (prompt: string) => Promise<string> {
    return async (prompt: string) => {
      try {
        const result = await this.providers.get('anthropic').complete({
          systemPrompt: 'You are a strict classifier. Reply with one label only.',
          messages: [{ role: 'user', content: prompt }],
          model: 'claude-haiku-4-5',
          maxTokens: 16,
        });
        return result.text;
      } catch (e) {
        this.log.warn(`classifier failed: ${(e as Error).message}`);
        return 'ALLOW';
      }
    };
  }
}
