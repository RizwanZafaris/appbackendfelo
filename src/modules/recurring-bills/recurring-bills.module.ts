import { Module } from '@nestjs/common';
import { RecurringBillsController } from './recurring-bills.controller';
import { RecurringBillsService } from './recurring-bills.service';

@Module({
  controllers: [RecurringBillsController],
  providers: [RecurringBillsService],
})
export class RecurringBillsModule {}
