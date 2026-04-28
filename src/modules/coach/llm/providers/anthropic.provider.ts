import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { calculateCostUsd } from '../cost-model';
import { CompletionRequest, CompletionResult, LlmProvider } from './base';

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: AnthropicUsage;
}

/**
 * Anthropic adapter. Uses the official REST API directly so we don't pull
 * the SDK into the backend's dep tree (NestJS already speaks fetch). The
 * system prompt is sent with `cache_control: ephemeral` so subsequent
 * calls in the same conversation hit Anthropic's prompt cache.
 */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  private readonly log = new Logger(AnthropicProvider.name);

  constructor(private readonly cfg: ConfigService) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const apiKey = this.cfg.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      system: [
        {
          type: 'text',
          text: req.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: req.messages,
    };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text();
      this.log.error(`Anthropic ${r.status}: ${detail.slice(0, 200)}`);
      throw new Error(`Anthropic API error ${r.status}`);
    }
    const data = (await r.json()) as AnthropicResponse;
    const text = data.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('');
    const u = data.usage;
    const tokens = {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    return {
      text,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      model: req.model,
      costUsd: calculateCostUsd(req.model, tokens),
    };
  }
}
