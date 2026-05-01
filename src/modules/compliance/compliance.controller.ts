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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { ComplianceService } from './compliance.service';
import {
  CreateThresholdDto,
  DecideFlagDto,
  UpdateThresholdDto,
} from './dto/compliance.dto';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly svc: ComplianceService) {}

  // ─── User-facing ─────────────────────────────────────────────
  /** A user can see flags raised against their own activity. */
  @Get('my-flags')
  myFlags(@CurrentUser() user: RequestUser) {
    return this.svc.listFlagsForUser(user.id);
  }

  // ─── Ops-facing (TODO: gate behind admin RBAC once admin auth fully wired) ───
  @Get('flags')
  listFlags(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listFlags({
      status,
      cursor,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Patch('flags/:id/decide')
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideFlagDto,
  ) {
    return this.svc.decide(id, user.id, dto.status, dto.reason);
  }

  @Post(':userId/scan')
  scan(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.scanUser(userId);
  }

  // ─── Threshold registry ──────────────────────────────────────
  @Get('thresholds')
  listThresholds() {
    return this.svc.listThresholds();
  }

  @Post('thresholds')
  createThreshold(@Body() dto: CreateThresholdDto) {
    return this.svc.createThreshold(dto);
  }

  @Patch('thresholds/:ruleKey')
  updateThreshold(
    @Param('ruleKey') ruleKey: string,
    @Body() dto: UpdateThresholdDto,
  ) {
    return this.svc.updateThreshold(ruleKey, dto);
  }

  @Delete('thresholds/:ruleKey')
  deleteThreshold(@Param('ruleKey') ruleKey: string) {
    return this.svc.deleteThreshold(ruleKey);
  }
}
