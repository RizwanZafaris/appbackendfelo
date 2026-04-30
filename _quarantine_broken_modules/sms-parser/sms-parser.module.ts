import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { SmsParserController } from './sms-parser.controller';
import { SmsParserService } from './sms-parser.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SmsParserController],
  providers: [SmsParserService],
  exports: [SmsParserService],
})
export class SmsParserModule {}
