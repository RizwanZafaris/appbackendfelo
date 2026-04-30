import {
  Body,
  Controller,
  Post,
  Headers,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RevenueCatService, RevenueCatWebhookEvent } from './revenuecat.service';

@ApiTags('payments / revenuecat')
@Controller('webhooks')
export class RevenueCatController {
  constructor(private readonly svc: RevenueCatService) {}

  @Post('revenuecat')
  @ApiOperation({ summary: 'RevenueCat webhook handler', description: 'Public — called by RevenueCat servers' })
  async handleWebhook(
    @Body() body: RevenueCatWebhookEvent,
    @Headers() headers: Record<string, string>,
  ) {
    if (!this.svc.verifyWebhook(headers)) {
      throw new UnauthorizedException('Invalid auth');
    }

    if (!body.event) throw new BadRequestException('Missing event');

    // Idempotency: skip if already processed (RevenueCat events have unique transaction_id)
    // In production, track processed event IDs in a deduplication table

    await this.svc.processEvent(body.event);

    return { received: true };
  }
}
