/**
 * Retry utility with exponential backoff and jitter.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableStatuses?: number[];
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    retryableStatuses = [408, 429, 500, 502, 503, 504],
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        throw lastError;
      }

      // Check if error is retryable (HTTP status or always retry)
      const status = (error as any)?.response?.status || (error as any)?.status;
      if (status && !retryableStatuses.includes(Number(status))) {
        throw lastError;
      }

      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs,
      );
      const jitteredDelay = delay * (0.5 + Math.random() * 0.5); // 50-100% of delay

      if (onRetry) {
        onRetry(attempt, lastError, jitteredDelay);
      }

      await sleep(jitteredDelay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
