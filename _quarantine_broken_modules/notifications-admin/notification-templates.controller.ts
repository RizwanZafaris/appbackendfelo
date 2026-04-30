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

import { NotificationTemplatesService } from './notification-templates.service';

@ApiTags('admin / notification templates')
@ApiBearerAuth()
@Controller('admin/notification-templates')
@RequiresAdmin('ops_manager')
export class NotificationTemplatesController {
  constructor(private readonly svc: NotificationTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List all notification templates' })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create notification template' })
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      name: string;
      type: 'push' | 'email' | 'inapp' | 'sms';
      titleEn: string;
      titleUr?: string;
      bodyEn: string;
      bodyUr?: string;
      variables?: string[];
      isActive?: boolean;
    },
  ) {
    return this.svc.create(admin.id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update notification template' })
  update(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<{
      name: string;
      type: 'push' | 'email' | 'inapp' | 'sms';
      titleEn: string;
      titleUr: string;
      bodyEn: string;
      bodyUr: string;
      variables: string[];
      isActive: boolean;
    }>,
  ) {
    return this.svc.update(admin.id, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete notification template' })
  @RequiresAdmin('super_admin')
  remove(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.delete(admin.id, id);
  }
}
