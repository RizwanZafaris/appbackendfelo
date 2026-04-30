import { Module } from '@nestjs/common';

import { CategorizationController } from './categorization.controller';
import { CategorizationService } from './categorization.service';

@Module({
  controllers: [CategorizationController],
  providers: [CategorizationService],
  exports: [CategorizationService],
})
export class CategorizationModule {}
