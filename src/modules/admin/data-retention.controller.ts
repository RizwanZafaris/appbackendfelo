import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';
import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';

import { DataRetentionService } from './data-retention.service';

@ApiTags('admin / data retention')
@ApiBearerAuth()
@Controller('admin/retention')
@RequiresAdmin('super_admin')
export class DataRetentionController {
  constructor(private readonly svc: DataRetentionService) {}

  @Get('policies')
  @ApiOperation({ summary: 'List all retention policies' })
  listPolicies() {
    return this.svc.listPolicies();
  }

  @Post('policies')
  @ApiOperation({ summary: 'Create retention policy' })
  createPolicy(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      name: string;
      resourceType: string;
      retentionDays: number;
      autoDelete?: boolean;
      isActive?: boolean;
      nextRunAt?: string;
    },
  ) {
    return this.svc.createPolicy(admin.id, {
      ...body,
      nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : undefined,
    });
  }

  @Patch('policies/:id')
  @ApiOperation({ summary: 'Update retention policy' })
  updatePolicy(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<typeof body>,
  ) {
    return this.svc.updatePolicy(admin.id, id, body);
  }

  @Delete('policies/:id')
  @ApiOperation({ summary: 'Delete retention policy' })
  removePolicy(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.deletePolicy(admin.id, id);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming deletions' })
  getUpcomingDeletions() {
    return this.svc.getUpcomingDeletions();
  }

  @Post('enforce')
  @ApiOperation({ summary: 'Manually trigger retention policy enforcement' })
  @RequiresAdmin('super_admin')
  enforce(@CurrentAdmin() admin: RequestAdmin) {
    return this.svc.enforceRetentionPolicies();
  }
}
