import { Injectable } from '@nestjs/common';

import { AnthropicProvider } from './anthropic.provider';
import { LlmProvider } from './base';
import { GeminiProvider } from './gemini.provider';
import { DeepSeekProvider, OpenAiProvider } from './openai.provider';

export const AVAILABLE_MODELS: Array<{ provider: LlmProvider['name']; model: string }> = [
  { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { provider: 'anthropic', model: 'claude-haiku-4-5' },
  { provider: 'anthropic', model: 'claude-opus-4-7' },
  { provider: 'openai', model: 'gpt-4o' },
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'gemini', model: 'gemini-1.5-pro' },
  { provider: 'deepseek', model: 'deepseek-chat' },
];

export const VALID_PAIRS = new Set(AVAILABLE_MODELS.map((m) => `${m.provider}:${m.model}`));

export function isValidPair(provider: string, model: string): boolean {
  return VALID_PAIRS.has(`${provider}:${model}`);
}

@Injectable()
export class ProviderRegistry {
  constructor(
    private readonly anthropic: AnthropicProvider,
    private readonly openai: OpenAiProvider,
    private readonly gemini: GeminiProvider,
    private readonly deepseek: DeepSeekProvider,
  ) {}

  get(name: string): LlmProvider {
    switch (name) {
      case 'anthropic':
        return this.anthropic;
      case 'openai':
        return this.openai;
      case 'gemini':
        return this.gemini;
      case 'deepseek':
        return this.deepseek;
      default:
        throw new Error(`Unknown provider: ${name}`);
    }
  }
}
