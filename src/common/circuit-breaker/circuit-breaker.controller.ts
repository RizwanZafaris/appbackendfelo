import { Controller, Get, Post, Delete, Body, Logger } from '@nestjs/common';
import {
  CircuitBreakerRegistry,
  CircuitBreaker,
} from '@/common/circuit-breaker/circuit-breaker';

@Controller('v1/system/circuit-breakers')
export class CircuitBreakerController {
  private readonly logger = new Logger(CircuitBreakerController.name);
  private readonly registry = new CircuitBreakerRegistry();

  /** Expose registry for other modules to use */
  getRegistry(): CircuitBreakerRegistry {
    return this.registry;
  }

  @Get()
  getAllStatus() {
    return {
      breakers: this.registry.getStatus().map((b) => ({
        provider: b.name,
        status: b.state.status,
        failures: b.state.failures,
        lastFailure: b.state.lastFailureTime,
      })),
    };
  }

  @Post('reset')
  resetBreaker(@Body('name') name: string) {
    this.registry.reset(name);
    this.logger.log(`Circuit breaker "${name}" manually reset`);
    return { message: `Breaker "${name}" reset`, ok: true };
  }

  @Delete('reset-all')
  resetAll() {
    this.registry.resetAll();
    this.logger.log('All circuit breakers reset');
    return { message: 'All breakers reset', ok: true };
  }
}
