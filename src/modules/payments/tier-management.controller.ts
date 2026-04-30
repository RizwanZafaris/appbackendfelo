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

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';
import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';
import { AuditService } from '@/common/services/audit.service';

import { TierManagementService } from './tier-management.service';

@ApiTags('admin / subscription tiers')
@ApiBearerAuth()
@Controller('admin/subscriptions')
@RequiresAdmin('support_agent')
export class TierManagementController {
  constructor(
    private readonly svc: TierManagementService,
    private readonly audit: AuditService,
  ) {}

  @Get('tiers')
  @ApiOperation({ summary: 'List all subscription tiers with entitlements' })
  listTiers() {
    return this.svc.listTiers();
  }

  @Post('tiers')
  @ApiOperation({ summary: 'Create a subscription tier' })
  @RequiresAdmin('ops_manager')
  async createTier(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      name: string;
      displayName: string;
      description?: string;
      priceMinor?: number;
      currency?: string;
      interval?: 'monthly' | 'yearly' | 'lifetime';
      stripePriceId?: string;
      revenuecatIdentifier?: string;
      entitlements?: Array<{ feature: string; limit?: number | null; period?: 'daily' | 'monthly' | 'lifetime' | null }>;
    },
  ) {
    const tier = await this.svc.createTier(body);
    await this.audit.log({
      actorId: admin.id,
      actorType: 'admin',
      action: 'create',
      resourceType: 'subscription_tier',
      resourceId: tier.id,
      after: tier as unknown as Record<string, unknown>,
    });
    return tier;
  }

  @Patch('tiers/:id')
  @ApiOperation({ summary: 'Update a subscription tier' })
  @RequiresAdmin('ops_manager')
  async updateTier(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      name?: string;
      displayName?: string;
      description?: string;
      priceMinor?: number;
      currency?: string;
      interval?: 'monthly' | 'yearly' | 'lifetime';
      stripePriceId?: string;
      revenuecatIdentifier?: string;
      isActive?: boolean;
      abSplit?: number;
      entitlements?: Array<{ feature: string; limit?: number | null; period?: 'daily' | 'monthly' | 'lifetime' | null }>;
    },
  ) {
    const tier = await this.svc.updateTier(id, body);
    await this.audit.log({
      actorId: admin.id,
      actorType: 'admin',
      action: 'update',
      resourceType: 'subscription_tier',
      resourceId: id,
      after: tier as unknown as Record<string, unknown>,
    });
    return tier;
  }

  @Get('entitlements')
  @ApiOperation({ summary: 'List entitlements for a tier' })
  @ApiQuery({ name: 'tierId', required: true })
  getEntitlements(@Query('tierId', ParseUUIDPipe) tierId: string) {
    return this.svc.getEntitlements(tierId);
  }
}
