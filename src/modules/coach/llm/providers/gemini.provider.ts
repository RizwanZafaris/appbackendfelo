import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { calculateCostUsd } from '../cost-model';
import { CompletionRequest, CompletionResult, LlmProvider } from './base';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private readonly log = new Logger(GeminiProvider.name);

  constructor(private readonly cfg: ConfigService) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const apiKey = this.cfg.get<string>('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    const body = {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: req.messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: req.maxTokens ?? 1024 },
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text();
      this.log.error(`Gemini ${r.status}: ${detail.slice(0, 200)}`);
      throw new Error(`Gemini API error ${r.status}`);
    }
    const data = (await r.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const inT = data.usageMetadata?.promptTokenCount ?? 0;
    const outT = data.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text,
      inputTokens: inT,
      outputTokens: outT,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: req.model,
      costUsd: calculateCostUsd(req.model, { input: inT, output: outT }),
    };
  }
}
