import { Module } from '@nestjs/common';
import { KybService } from './kyb.service';
import { KybController, AdminKybController } from './kyb.controller';

@Module({
  providers: [KybService],
  controllers: [KybController, AdminKybController],
  exports: [KybService],
})
export class KybModule {}
