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

import { FeatureFlagsAdminService } from './feature-flags-admin.service';

@ApiTags('admin / feature flags')
@ApiBearerAuth()
@Controller('admin/flags')
@RequiresAdmin('ops_manager')
export class FeatureFlagsAdminController {
  constructor(private readonly svc: FeatureFlagsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List all feature flags' })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a feature flag' })
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      key: string;
      name: string;
      description?: string;
      enabled?: boolean;
      targeting?: Record<string, string[]>;
    },
  ) {
    return this.svc.create(admin.id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a feature flag' })
  update(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      name?: string;
      description?: string;
      enabled?: boolean;
      targeting?: Record<string, string[]>;
    },
  ) {
    return this.svc.update(admin.id, id, body);
  }

  @Post(':id/kill')
  @ApiOperation({ summary: 'Kill switch — immediately disable a feature' })
  killSwitch(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.killSwitch(admin.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a feature flag' })
  @RequiresAdmin('super_admin')
  remove(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.delete(admin.id, id);
  }

  @Get('check')
  @ApiOperation({ summary: 'Check if a feature flag is enabled for context' })
  @ApiQuery({ name: 'key', required: true })
  @ApiQuery({ name: 'corridor', required: false })
  @ApiQuery({ name: 'tier', required: false })
  checkFlag(
    @Query('key') key: string,
    @Query('corridor') corridor?: string,
    @Query('tier') tier?: string,
  ) {
    return this.svc.checkFlag(key, { corridor, tier });
  }
}
