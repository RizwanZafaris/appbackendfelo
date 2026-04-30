import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuditLogModule } from '@/modules/audit-log/audit-log.module';

import { FeloScoresController } from './felo-scores.controller';
import { FeloScoresService } from './felo-scores.service';

@Module({
  imports: [ScheduleModule.forRoot(), AuditLogModule],
  controllers: [FeloScoresController],
  providers: [FeloScoresService],
  exports: [FeloScoresService],
})
export class FeloScoresModule {}
