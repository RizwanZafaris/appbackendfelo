import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { NotificationCampaignsService } from './notification-campaigns.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationsService } from './notifications.service';

class CreateTemplateDto {
  type!: string;
  channel!: 'push' | 'email' | 'inapp' | 'sms';
  titleEn!: string;
  bodyEn!: string;
  titleUr?: string;
  bodyUr?: string;
  variables?: string[];
}

class UpdateTemplateDto {
  titleEn?: string;
  bodyEn?: string;
  titleUr?: string;
  bodyUr?: string;
  isActive?: boolean;
}

class CreateCampaignDto {
  name!: string;
  templateType!: string;
  audienceFilter?: Record<string, unknown>;
  scheduledAt?: string;
}

@ApiTags('admin/notifications')
@ApiBearerAuth()
@Controller('admin/notifications')
export class NotificationsAdminController {
  constructor(
    private readonly tmplSvc: NotificationTemplateService,
    private readonly campaignSvc: NotificationCampaignsService,
    private readonly notifSvc: NotificationsService,
  ) {}

  // ---- Template CRUD ----

  @Get('templates')
  @ApiOperation({ summary: 'List all notification templates' })
  listTemplates() {
    return this.tmplSvc.listTemplates();
  }

  @Post('templates')
  @ApiBody({ type: CreateTemplateDto })
  @ApiOperation({ summary: 'Create a notification template' })
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.tmplSvc.createTemplate(dto);
  }

  @Patch('templates/:id')
  @ApiBody({ type: UpdateTemplateDto })
  @ApiOperation({ summary: 'Update a notification template' })
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.tmplSvc.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Delete a notification template' })
  deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tmplSvc.deleteTemplate(id);
  }

  // ---- Campaign Builder ----

  @Get('campaigns')
  @ApiOperation({ summary: 'List notification campaigns' })
  listCampaigns() {
    return this.campaignSvc.listCampaigns();
  }

  @Post('campaigns')
  @ApiBody({ type: CreateCampaignDto })
  @ApiOperation({ summary: 'Create a notification campaign' })
  createCampaign(@Body() dto: CreateCampaignDto) {
    return this.campaignSvc.createCampaign(dto);
  }

  @Post('campaigns/:id/send')
  @ApiOperation({ summary: 'Send a campaign immediately' })
  sendCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaignSvc.sendCampaign(id);
  }

  @Post('campaigns/:id/cancel')
  @ApiOperation({ summary: 'Cancel a scheduled campaign' })
  cancelCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaignSvc.cancelCampaign(id);
  }

  // ---- Metrics ----

  @Get('metrics')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOperation({ summary: 'Notification metrics summary' })
  metrics(@Query('days') days?: string) {
    return this.notifSvc.metrics(days ? parseInt(days, 10) : 30);
  }
}
