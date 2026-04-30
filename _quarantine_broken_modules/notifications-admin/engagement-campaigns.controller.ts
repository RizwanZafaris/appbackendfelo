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

import { EngagementCampaignsService } from './engagement-campaigns.service';

@ApiTags('admin / campaigns')
@ApiBearerAuth()
@Controller('admin/campaigns')
@RequiresAdmin('ops_manager')
export class EngagementCampaignsController {
  constructor(private readonly svc: EngagementCampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'List all engagement campaigns' })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create engagement campaign' })
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      name: string;
      description?: string;
      templateId: string;
      audienceFilter?: Record<string, unknown>;
      scheduledAt?: string;
    },
  ) {
    return this.svc.create(admin.id, {
      ...body,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update engagement campaign' })
  update(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<typeof body>,
  ) {
    return this.svc.update(admin.id, id, body);
  }

  @Post(':id/schedule')
  @ApiOperation({ summary: 'Schedule a campaign' })
  schedule(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scheduledAt: string },
  ) {
    return this.svc.schedule(admin.id, id, new Date(body.scheduledAt));
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a scheduled campaign' })
  cancel(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancel(admin.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete engagement campaign' })
  @RequiresAdmin('super_admin')
  remove(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.delete(admin.id, id);
  }
}
