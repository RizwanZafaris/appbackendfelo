/** Shared types for LLM provider adapters. */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  costUsd: number;
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  model: string;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'fake';
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
