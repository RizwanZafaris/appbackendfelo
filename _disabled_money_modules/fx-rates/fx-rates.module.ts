import { Module } from '@nestjs/common';

import { FxRatesController } from './fx-rates.controller';
import { FxRatesService } from './fx-rates.service';

@Module({
  controllers: [FxRatesController],
  providers: [FxRatesService],
  exports: [FxRatesService],
})
export class FxRatesModule {}
