import { Module } from '@nestjs/common';
import { FeloScoresController } from './felo-scores.controller';
import { FeloScoresService } from './felo-scores.service';

@Module({
  controllers: [FeloScoresController],
  providers: [FeloScoresService],
})
export class FeloScoresModule {}
