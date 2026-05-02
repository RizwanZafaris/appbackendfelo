import { Module } from '@nestjs/common';
import { TmsService } from './tms.service';
import { TmsController } from './tms.controller';

@Module({
  providers: [TmsService],
  controllers: [TmsController],
  exports: [TmsService],
})
export class TmsModule {}
