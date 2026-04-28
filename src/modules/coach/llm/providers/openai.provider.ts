import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { calculateCostUsd } from '../cost-model';
import { CompletionRequest, CompletionResult, LlmProvider } from './base';

interface OpenAiResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

/**
 * OpenAI / OpenAI-compatible adapter. DeepSeek extends this with a
 * different baseURL since it speaks the OpenAI chat-completions schema.
 */
@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name: 'openai' | 'deepseek' = 'openai';
  protected readonly log = new Logger(OpenAiProvider.name);

  constructor(protected readonly cfg: ConfigService) {}

  protected get baseUrl(): string {
    return 'https://api.openai.com/v1';
  }

  protected get apiKey(): string {
    const k = this.cfg.get<string>('OPENAI_API_KEY');
    if (!k) throw new Error('OPENAI_API_KEY not configured');
    return k;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [{ role: 'system', content: req.systemPrompt }, ...req.messages],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      this.log.error(`${this.name} ${r.status}: ${detail.slice(0, 200)}`);
      throw new Error(`${this.name} API error ${r.status}`);
    }
    const data = (await r.json()) as OpenAiResponse;
    const text = data.choices[0]?.message.content ?? '';
    const u = data.usage;
    return {
      text,
      inputTokens: u.prompt_tokens,
      outputTokens: u.completion_tokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: req.model,
      costUsd: calculateCostUsd(req.model, { input: u.prompt_tokens, output: u.completion_tokens }),
    };
  }
}

@Injectable()
export class DeepSeekProvider extends OpenAiProvider implements LlmProvider {
  override readonly name: 'openai' | 'deepseek' = 'deepseek';
  protected override get baseUrl(): string {
    return 'https://api.deepseek.com/v1';
  }
  protected override get apiKey(): string {
    const k = this.cfg.get<string>('DEEPSEEK_API_KEY');
    if (!k) throw new Error('DEEPSEEK_API_KEY not configured');
    return k;
  }
}
