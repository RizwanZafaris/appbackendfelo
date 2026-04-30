import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';

import { DashboardService } from './dashboard.service';

@ApiTags('admin / dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
@RequiresAdmin('read_only')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get DAU/MAU, MRR, ARPU stats' })
  getStats() {
    return this.svc.getStats();
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Get signup funnel metrics' })
  getFunnel() {
    return this.svc.getFunnel();
  }

  @Get('sources')
  @ApiOperation({ summary: 'Get transactions by source' })
  getSources() {
    return this.svc.getSources();
  }
}
