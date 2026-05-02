import { Logger } from '@nestjs/common';

interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime: number | null;
  successCount: number;
}

export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private state: CircuitBreakerState;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly name: string;

  constructor(
    name: string,
    options: {
      failureThreshold?: number;
      resetTimeoutMs?: number;
      halfOpenMaxCalls?: number;
    } = {},
  ) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 3;
    this.state = {
      status: 'closed',
      failures: 0,
      lastFailureTime: null,
      successCount: 0,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.status === 'open') {
      if (this.shouldAttemptReset()) {
        this.transitionTo('half-open');
      } else {
        throw new CircuitBreakerOpenError(
          `Circuit breaker "${this.name}" is OPEN. Provider temporarily unavailable.`,
        );
      }
    }

    if (this.state.status === 'half-open' && this.state.successCount >= this.halfOpenMaxCalls) {
      this.transitionTo('closed');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state.status === 'half-open') {
      this.state.successCount++;
      if (this.state.successCount >= this.halfOpenMaxCalls) {
        this.transitionTo('closed');
      }
    } else {
      this.state.failures = 0;
    }
  }

  private onFailure(): void {
    this.state.failures++;
    this.state.lastFailureTime = Date.now();

    if (this.state.status === 'half-open') {
      this.transitionTo('open');
    } else if (this.state.failures >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.state.lastFailureTime) return true;
    return Date.now() - this.state.lastFailureTime >= this.resetTimeoutMs;
  }

  private transitionTo(status: 'closed' | 'open' | 'half-open'): void {
    const oldStatus = this.state.status;
    this.state.status = status;

    if (status === 'closed') {
      this.state.failures = 0;
      this.state.lastFailureTime = null;
      this.state.successCount = 0;
    } else if (status === 'half-open') {
      this.state.successCount = 0;
    }

    this.logger.warn(
      `Circuit breaker "${this.name}": ${oldStatus} → ${status}`,
    );
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  getName(): string {
    return this.name;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/** Registry of circuit breakers per provider */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  getOrCreate(
    name: string,
    options?: ConstructorParameters<typeof CircuitBreaker>[1],
  ): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, options));
    }
    return this.breakers.get(name)!;
  }

  getStatus(): Array<{ name: string; state: CircuitBreakerState }> {
    return Array.from(this.breakers.entries()).map(([name, breaker]) => ({
      name,
      state: breaker.getState(),
    }));
  }

  reset(name: string): void {
    this.breakers.delete(name);
  }

  resetAll(): void {
    this.breakers.clear();
  }
}
