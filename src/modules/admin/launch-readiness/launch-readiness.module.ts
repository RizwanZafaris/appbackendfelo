import { Module } from '@nestjs/common';

import { LaunchReadinessController } from './launch-readiness.controller';
import { LaunchReadinessService } from './launch-readiness.service';

@Module({
  controllers: [LaunchReadinessController],
  providers: [LaunchReadinessService],
  exports: [LaunchReadinessService],
})
export class LaunchReadinessModule {}
