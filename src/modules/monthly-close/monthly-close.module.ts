import { Module } from '@nestjs/common';
import { MonthlyCloseController } from './monthly-close.controller';
import { MonthlyCloseService } from './monthly-close.service';

@Module({
  controllers: [MonthlyCloseController],
  providers: [MonthlyCloseService],
  exports: [MonthlyCloseService],
})
export class MonthlyCloseModule {}
