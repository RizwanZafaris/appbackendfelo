import { Module, Global } from '@nestjs/common';
import { CircuitBreakerController } from './circuit-breaker.controller';
import { CircuitBreakerRegistry } from './circuit-breaker';

@Global()
@Module({
  controllers: [CircuitBreakerController],
  providers: [CircuitBreakerRegistry],
  exports: [CircuitBreakerRegistry],
})
export class CircuitBreakerModule {}
