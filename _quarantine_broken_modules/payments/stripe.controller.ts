import {
  Body,
  Controller,
  Post,
  Headers,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { StripeService } from './stripe.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

@ApiTags('payments / stripe')
@Controller()
export class StripeController {
  constructor(private readonly svc: StripeService) {}

  @Post('subscriptions/checkout')
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  async createCheckout(
    @CurrentUser() user: RequestUser,
    @Body() body: { priceId: string; successUrl: string; cancelUrl: string },
  ) {
    return this.svc.createCheckoutSession({
      priceId: body.priceId,
      userId: user.id,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });
  }

  @Post('webhooks/stripe')
  @ApiOperation({ summary: 'Stripe webhook handler', description: 'Public — called by Stripe' })
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) throw new BadRequestException('Missing stripe-signature header');

    const rawBody = JSON.stringify(req.body);
    const event = await this.svc.verifyWebhook(rawBody, signature);

    switch (event.type) {
      case 'invoice.paid':
        await this.svc.handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        // Subscription goes past_due
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.svc.handleSubscriptionUpdated(event);
        break;
      default:
        break;
    }

    return { received: true };
  }
}
