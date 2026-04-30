import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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

import { CreateNotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';
import { NotificationTriggersService } from './triggers.service';
import { BannersService } from './banners.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly svc: NotificationsService,
    private readonly triggers: NotificationTriggersService,
    private readonly banners: BannersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List notifications (most recent 100)' })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  list(@CurrentUser() user: RequestUser, @Query('unreadOnly') unreadOnly?: string) {
    return this.svc.list(user.id, { unreadOnly: unreadOnly === 'true' });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications' })
  unreadCount(@CurrentUser() user: RequestUser) {
    return this.svc.unreadCount(user.id);
  }

  /**
   * Test/debug endpoint to create an in-app notification. Production
   * builds disable this — real notifications are emitted server-side
   * by the notification service in response to budget/goal/family
   * events. Returns 403 in production to make abuse impossible.
   */
  @Post()
  @ApiOperation({ summary: 'Create an in-app notification (debug-only; 403 in production)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateNotificationDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Disabled in production');
    }
    return this.svc.create(user.id, dto);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(user.id, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.svc.markAllRead(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user.id, id);
  }

  @Post('dispatch')
  @ApiOperation({ summary: 'Render a notification template and persist it' })
  dispatch(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      templateKey: string;
      variables: Record<string, string>;
      channel?: 'push' | 'email' | 'inapp' | 'sms';
    },
  ) {
    return this.svc.dispatch(user.id, body.templateKey, body.variables, body.channel);
  }

  // ─── Triggers (E4) ─────────────────────────────────────
  @Get('triggers')
  listTriggers(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.triggers.list(cursor, limit ? parseInt(limit, 10) : 50);
  }

  @Post('triggers')
  createTrigger(
    @Body()
    body: {
      ruleKey: string;
      conditionDsl: Record<string, unknown>;
      templateKey: string;
      channelPriority?: unknown[];
      throttlePerDay?: number;
      audience?: Record<string, unknown>;
    },
  ) {
    return this.triggers.create(body);
  }

  @Patch('triggers/:id')
  updateTrigger(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      conditionDsl: Record<string, unknown>;
      templateKey: string;
      channelPriority: unknown[];
      throttlePerDay: number;
      audience: Record<string, unknown>;
      isActive: boolean;
    }>,
  ) {
    return this.triggers.update(id, body);
  }

  @Delete('triggers/:id')
  deleteTrigger(@Param('id') id: string) {
    return this.triggers.remove(id);
  }

  // ─── Banners (E2) ──────────────────────────────────────
  @Get('banners')
  listActiveBanners() {
    return this.banners.listActive();
  }

  @Get('banners/all')
  listAllBanners(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.banners.listAll(cursor, limit ? parseInt(limit, 10) : 50);
  }

  @Post('banners')
  createBanner(
    @Body()
    body: {
      titleEn: string;
      titleUr?: string;
      body: string;
      actionUrl?: string;
      audience?: Record<string, unknown>;
      priority?: number;
      startAt?: string;
      endAt?: string;
    },
  ) {
    return this.banners.create({
      titleEn: body.titleEn,
      titleUr: body.titleUr,
      body: body.body,
      actionUrl: body.actionUrl,
      audience: body.audience,
      priority: body.priority,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      endAt: body.endAt ? new Date(body.endAt) : undefined,
    });
  }

  @Patch('banners/:id')
  updateBanner(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      titleEn: string;
      titleUr: string;
      body: string;
      actionUrl: string;
      audience: Record<string, unknown>;
      priority: number;
      startAt: string;
      endAt: string;
      isActive: boolean;
    }>,
  ) {
    return this.banners.update(id, {
      titleEn: body.titleEn,
      titleUr: body.titleUr,
      body: body.body,
      actionUrl: body.actionUrl,
      audience: body.audience,
      priority: body.priority,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      endAt: body.endAt ? new Date(body.endAt) : undefined,
      isActive: body.isActive,
    });
  }

  @Delete('banners/:id')
  deleteBanner(@Param('id') id: string) {
    return this.banners.remove(id);
  }
}
