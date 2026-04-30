import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { PatchFlagDto } from './dto/compliance.dto';
import { ComplianceService } from './compliance.service';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('admin/compliance')
export class ComplianceController {
  constructor(private readonly svc: ComplianceService) {}

  @Get('flags')
  @ApiOperation({ summary: 'Get compliance review queue' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'assigned', 'approved', 'rejected', 'escalated'] })
  getFlags(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.getReviewQueue({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
    });
  }

  @Patch('flags/:id')
  @ApiOperation({ summary: 'Update flag status (assign, approve, reject, escalate)' })
  patchFlag(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchFlagDto,
  ) {
    return this.svc.patchFlag(id, dto, user.id);
  }
}
