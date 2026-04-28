/**
 * Token rates and per-call cost calculation for the Coach LLM layer.
 * Rates are USD per 1M tokens. Update here when providers change pricing.
 */

export interface CostRate {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const COST_RATES: Record<string, CostRate> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
  'claude-opus-4-7': { input: 15.0, output: 75.0, cacheWrite: 0, cacheRead: 0 },
  'gpt-4o': { input: 2.5, output: 10.0, cacheWrite: 0, cacheRead: 0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheWrite: 0, cacheRead: 0 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0, cacheWrite: 0, cacheRead: 0 },
  'deepseek-chat': { input: 0.27, output: 1.1, cacheWrite: 0, cacheRead: 0 },
};

export function calculateCostUsd(
  model: string,
  tokens: { input?: number; output?: number; cacheWrite?: number; cacheRead?: number },
): number {
  const r = COST_RATES[model];
  if (!r) return 0;
  return (
    ((tokens.input ?? 0) * r.input +
      (tokens.output ?? 0) * r.output +
      (tokens.cacheWrite ?? 0) * r.cacheWrite +
      (tokens.cacheRead ?? 0) * r.cacheRead) /
    1_000_000
  );
}
