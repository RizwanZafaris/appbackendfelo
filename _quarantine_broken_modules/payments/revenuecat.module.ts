import { Module } from '@nestjs/common';
import { RevenueCatController } from './revenuecat.controller';
import { RevenueCatService } from './revenuecat.service';

@Module({
  controllers: [RevenueCatController],
  providers: [RevenueCatService],
  exports: [RevenueCatService],
})
export class RevenueCatModule {}
