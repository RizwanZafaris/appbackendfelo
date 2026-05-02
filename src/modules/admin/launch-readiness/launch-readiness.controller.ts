import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { RequestUser } from '@/common/types/request-user';

import {
  LaunchReadinessService,
  LaunchStatus,
} from './launch-readiness.service';

class UpdateStatusDto {
  @IsIn(['pending', 'in_progress', 'done', 'blocked'])
  status!: LaunchStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * Admin endpoints behind the ops-portal /launch-readiness page.
 *
 * Auth: SupabaseJwtGuard (global) + RolesGuard('admin'). Anyone tampering
 * with the checklist bypasses the FELO_LAUNCH_READY=1 gate, so admin-only.
 */
@ApiTags('admin: launch-readiness')
@Controller('admin/launch-readiness')
@UseGuards(SupabaseJwtGuard, RolesGuard)
@Roles('admin')
export class LaunchReadinessController {
  constructor(private readonly svc: LaunchReadinessService) {}

  @Get('items')
  @ApiOperation({ summary: 'List launch-readiness items' })
  list(
    @Query('category') category?: string,
    @Query('status') status?: LaunchStatus,
    @Query('blocking') blocking?: 'true' | 'false',
  ) {
    return this.svc.list({
      category,
      status,
      blocking: blocking === undefined ? undefined : blocking === 'true',
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Summary counts + readyToLaunch boolean' })
  summary() {
    return this.svc.summary();
  }

  @Patch('items/:id/status')
  @ApiOperation({ summary: 'Update an item status (audit-logged)' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateStatusDto,
  ) {
    return this.svc.setStatus(id, user.id, body);
  }
}
