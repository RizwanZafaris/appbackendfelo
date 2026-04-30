import { Module } from '@nestjs/common';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';
import { StripeService } from './stripe.service';

@Module({
  controllers: [RefundController],
  providers: [RefundService, StripeService],
  exports: [RefundService],
})
export class RefundModule {}
