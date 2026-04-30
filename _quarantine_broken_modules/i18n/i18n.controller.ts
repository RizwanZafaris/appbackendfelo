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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';
import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';
import { Public } from '@/common/decorators/public.decorator';

import { I18nService } from './i18n.service';

@ApiTags('i18n')
@Controller()
export class I18nController {
  constructor(private readonly svc: I18nService) {}

  // --- Public ---

  @Get('i18n/strings')
  @Public()
  @ApiOperation({ summary: 'Get all strings for a locale' })
  @ApiQuery({ name: 'locale', required: false })
  getStrings(@Query('locale') locale?: string) {
    return this.svc.getStrings(locale ?? 'en');
  }

  // --- Admin ---

  @Get('admin/i18n/strings')
  @ApiBearerAuth()
  @RequiresAdmin('support_agent')
  @ApiOperation({ summary: 'List all i18n strings (admin)' })
  @ApiQuery({ name: 'q', required: false })
  listAdmin(@Query('q') q?: string) {
    return this.svc.list(q);
  }

  @Post('admin/i18n/strings')
  @ApiBearerAuth()
  @RequiresAdmin('ops_manager')
  @ApiOperation({ summary: 'Create i18n string' })
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: { key: string; valueEn: string; valueUr?: string; context?: string },
  ) {
    return this.svc.create(admin.id, body);
  }

  @Patch('admin/i18n/strings/:id')
  @ApiBearerAuth()
  @RequiresAdmin('ops_manager')
  @ApiOperation({ summary: 'Update i18n string' })
  update(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { valueEn?: string; valueUr?: string; context?: string },
  ) {
    return this.svc.update(admin.id, id, body);
  }

  @Delete('admin/i18n/strings/:id')
  @ApiBearerAuth()
  @RequiresAdmin('super_admin')
  @ApiOperation({ summary: 'Delete i18n string' })
  remove(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.delete(admin.id, id);
  }
}
