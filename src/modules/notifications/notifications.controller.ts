import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CreateNotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

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

  @Post('subscribe')
  @ApiOperation({ summary: 'Register device for push notifications' })
  async subscribe(
    @CurrentUser() user: RequestUser,
    @Body() body: { platform: 'ios' | 'android' | 'web'; pushToken: string },
  ) {
    return this.svc.registerDevice(user.id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user.id, id);
  }
}
