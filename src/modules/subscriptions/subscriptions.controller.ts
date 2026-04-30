import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { CurrentUser } from '@/common/decorators/current-user.decorator';

import { SubscriptionsService, type TierLimits } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  @Get('tier')
  async getTier(@CurrentUser('sub') userId: string) {
    const tier = await this.service.getUserTier(userId);
    const limits = await this.service.getTierLimits(userId);
    const usage = await this.service.getUsage(userId);
    return { tier, limits, usage };
  }

  @Get('check/:feature')
  async checkFeature(
    @CurrentUser('sub') userId: string,
    @Param('feature') feature: keyof TierLimits,
  ) {
    return this.service.checkLimit(userId, feature);
  }

  @Post('upgrade')
  async upgrade(@CurrentUser('sub') userId: string, @Body('tier') tier: string) {
    await this.service.upgradeTier(userId, tier);
    return { upgraded: true, tier };
  }

  // ─── Tier registry ──────────────────────────────────────────────
  @Get('tiers')
  getTiers() {
    return this.service.getTiers();
  }

  @Get('tiers/:key')
  getTierByKey(@Param('key') key: string) {
    return this.service.getTier(key);
  }

  // ─── Coupons ────────────────────────────────────────────────────
  @Post('coupons/validate')
  validateCoupon(@Body() body: { code: string }) {
    return this.service.validateCoupon(body.code);
  }

  // ─── Paywall A/B ────────────────────────────────────────────────
  @Get('paywall/:experimentKey')
  getPaywall(@CurrentUser('sub') userId: string, @Param('experimentKey') key: string) {
    return this.service.getPaywallVariant(key, userId);
  }

  @Post('paywall/:variantId/convert')
  trackConversion(@Param('variantId') id: string) {
    return this.service.trackConversion(id);
  }

  @Get('current')
  getCurrent(@CurrentUser('sub') userId: string) {
    return this.service.getCurrentSubscription(userId);
  }
}
