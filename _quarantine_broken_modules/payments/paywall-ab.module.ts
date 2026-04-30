import { Module } from '@nestjs/common';
import { PaywallAbController } from './paywall-ab.controller';
import { PaywallAbService } from './paywall-ab.service';

@Module({
  controllers: [PaywallAbController],
  providers: [PaywallAbService],
  exports: [PaywallAbService],
})
export class PaywallAbModule {}
