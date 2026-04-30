import { Module } from '@nestjs/common';
import { DataRetentionController } from './data-retention.controller';
import { DataRetentionService } from './data-retention.service';

@Module({
  controllers: [DataRetentionController],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
