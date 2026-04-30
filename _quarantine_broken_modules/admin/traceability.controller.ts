import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';
import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';
import { AuditService } from '@/common/services/audit.service';

import { TraceabilityService } from './traceability.service';

@ApiTags('admin / traceability')
@ApiBearerAuth()
@Controller('admin/traceability')
@RequiresAdmin('support_agent')
export class TraceabilityController {
  constructor(
    private readonly svc: TraceabilityService,
    private readonly audit: AuditService,
  ) {}

  @Get('user/:id/timeline')
  @ApiOperation({ summary: 'Get full timeline for a user' })
  async getUserTimeline(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.audit.log({
      actorId: admin.id,
      actorType: 'admin',
      action: 'read_pii',
      resourceType: 'user_timeline',
      resourceId: id,
      metadata: { endpoint: 'traceability/user/:id/timeline' },
    });
    return this.svc.getUserTimeline(id);
  }

  @Get('transaction/:id/lineage')
  @ApiOperation({ summary: 'Get transaction lineage' })
  getTransactionLineage(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getTransactionLineage(id);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search users and transactions' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false })
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.svc.search(q, limit ? parseInt(limit, 10) : 20);
  }
}
