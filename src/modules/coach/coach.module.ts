import { Module } from '@nestjs/common';

import { InsightsModule } from '@/modules/insights/insights.module';

import { CoachRulesService } from './coach-rules.service';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';

@Module({
  imports: [InsightsModule],
  controllers: [CoachController],
  providers: [CoachService, CoachRulesService],
})
export class CoachModule {}
