import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';

import { AuditViewerService } from './audit-viewer.service';

@ApiTags('admin / audit')
@ApiBearerAuth()
@Controller('admin/audit')
@RequiresAdmin('read_only')
export class AuditViewerController {
  constructor(private readonly svc: AuditViewerService) {}

  @Get('search')
  @ApiOperation({ summary: 'Full-text search audit logs' })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'resourceType', required: false })
  @ApiQuery({ name: 'resourceId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  search(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.search({
      actorId,
      action,
      resourceType,
      resourceId,
      from,
      to,
      query: q,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('diff/:id')
  @ApiOperation({ summary: 'Get before/after diff for an audit entry' })
  getDiff(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getDiff(id);
  }

  @Get('actor/:id')
  @ApiOperation({ summary: 'Get audit entries for a specific actor' })
  @ApiQuery({ name: 'limit', required: false })
  getActorReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getActorReport(id, limit ? parseInt(limit, 10) : 100);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Detect audit anomalies' })
  @RequiresAdmin('ops_manager')
  detectAnomalies() {
    return this.svc.detectAnomalies();
  }
}
