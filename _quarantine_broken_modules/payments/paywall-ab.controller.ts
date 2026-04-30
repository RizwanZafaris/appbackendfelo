import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';
import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';
import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';
import { AuditService } from '@/common/services/audit.service';

import { PaywallAbService } from './paywall-ab.service';

@ApiTags('paywall / ab-testing')
@Controller()
export class PaywallAbController {
  constructor(
    private readonly svc: PaywallAbService,
    private readonly audit: AuditService,
  ) {}

  // --- Public endpoints ---

  @Get('paywall/config')
  @ApiOperation({ summary: 'Get user\'s assigned paywall variant' })
  @ApiBearerAuth()
  async getConfig(@CurrentUser() user: RequestUser) {
    return this.svc.getUserConfig(user.id);
  }

  @Post('paywall/track')
  @ApiOperation({ summary: 'Track paywall impression' })
  @ApiBearerAuth()
  async trackImpression(
    @CurrentUser() user: RequestUser,
    @Body() body: { variantId: string },
  ) {
    return this.svc.trackImpression(user.id, body.variantId);
  }

  @Post('paywall/convert')
  @ApiOperation({ summary: 'Track paywall conversion' })
  @ApiBearerAuth()
  async trackConversion(
    @CurrentUser() user: RequestUser,
    @Body() body: { variantId: string },
  ) {
    return this.svc.trackConversion(user.id, body.variantId);
  }

  // --- Admin endpoints ---

  @Get('admin/paywall/variants')
  @ApiOperation({ summary: 'List all paywall variants' })
  @ApiBearerAuth()
  @RequiresAdmin('ops_manager')
  listVariants() {
    return this.svc.listVariants();
  }

  @Post('admin/paywall/variants')
  @ApiOperation({ summary: 'Create a paywall variant' })
  @ApiBearerAuth()
  @RequiresAdmin('ops_manager')
  async createVariant(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      name: string;
      headline: string;
      subheadline?: string;
      ctaText: string;
      pricingAnchor?: string;
      badge?: string;
      displayOrder?: number;
      trafficPercent?: number;
    },
  ) {
    const variant = await this.svc.createVariant({
      ...body,
      isActive: true,
    });
    await this.audit.log({
      actorId: admin.id,
      actorType: 'admin',
      action: 'create',
      resourceType: 'paywall_variant',
      resourceId: variant.id,
      after: variant as unknown as Record<string, unknown>,
    });
    return variant;
  }

  @Patch('admin/paywall/variants/:id')
  @ApiOperation({ summary: 'Update a paywall variant' })
  @ApiBearerAuth()
  @RequiresAdmin('ops_manager')
  async updateVariant(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<{
      name: string;
      headline: string;
      subheadline: string;
      ctaText: string;
      pricingAnchor: string;
      badge: string;
      displayOrder: number;
      isActive: boolean;
      trafficPercent: number;
    }>,
  ) {
    const variant = await this.svc.updateVariant(id, body);
    await this.audit.log({
      actorId: admin.id,
      actorType: 'admin',
      action: 'update',
      resourceType: 'paywall_variant',
      resourceId: id,
      after: variant as unknown as Record<string, unknown>,
    });
    return variant;
  }

  @Get('admin/paywall/metrics')
  @ApiOperation({ summary: 'Get A/B test metrics' })
  @ApiBearerAuth()
  @RequiresAdmin('ops_manager')
  getMetrics() {
    return this.svc.getMetrics();
  }
}
