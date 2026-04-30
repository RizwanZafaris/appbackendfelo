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

import { AnnouncementBannersService } from './announcement-banners.service';

@ApiTags('admin / announcement banners')
@ApiBearerAuth()
@Controller('admin/banners')
@RequiresAdmin('ops_manager')
export class AnnouncementBannersController {
  constructor(private readonly svc: AnnouncementBannersService) {}

  @Get()
  @ApiOperation({ summary: 'List all announcement banners' })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create announcement banner' })
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      name: string;
      titleEn: string;
      titleUr?: string;
      bodyEn?: string;
      bodyUr?: string;
      ctaText?: string;
      ctaAction?: string;
      imageUrl?: string;
      audience?: Record<string, string[]>;
      priority?: number;
      startsAt?: string;
      endsAt?: string;
      isActive?: boolean;
    },
  ) {
    return this.svc.create(admin.id, {
      ...body,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update announcement banner' })
  update(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<typeof body>,
  ) {
    return this.svc.update(admin.id, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete announcement banner' })
  @RequiresAdmin('super_admin')
  remove(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.delete(admin.id, id);
  }
}
