import { Controller, Get, Res, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';

import { AdminAnalyticsService } from './analytics.service';

@ApiTags('admin / analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
@RequiresAdmin('read_only')
export class AdminAnalyticsController {
  constructor(private readonly svc: AdminAnalyticsService) {}

  @Get('cohorts')
  @ApiOperation({ summary: 'Get retention cohorts' })
  getCohorts() {
    return this.svc.getCohorts();
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Get 5-stage signup funnel' })
  getFunnel() {
    return this.svc.getFunnel();
  }

  @Get('mrr')
  @ApiOperation({ summary: 'Get MRR waterfall' })
  getMrr() {
    return this.svc.getMrr();
  }

  @Get('ltv')
  @ApiOperation({ summary: 'Get lifetime value estimates' })
  getLtv() {
    return this.svc.getLtv();
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'Export analytics CSV' })
  @ApiResponse({
    status: 200,
    description: 'CSV file',
    content: { 'text/csv': {} },
  })
  async exportCsv(@Res() res: Response) {
    const csv = await this.svc.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="felo-analytics.csv"');
    res.send(csv);
  }
}
