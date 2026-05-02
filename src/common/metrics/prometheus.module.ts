import { Module, Global } from '@nestjs/common';
import { PrometheusController } from './prometheus.controller';
import { PrometheusService } from './prometheus.service';

@Global()
@Module({
  controllers: [PrometheusController],
  providers: [PrometheusService],
  exports: [PrometheusService],
})
export class PrometheusModule {}
