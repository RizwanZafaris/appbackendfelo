import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { InsightPeriod, InsightsService } from './insights.service';

@ApiTags('insights')
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(private readonly svc: InsightsService) {}

  @Get('spending')
  @ApiOperation({ summary: 'Spending breakdown — totals, categories, merchants, trends' })
  @ApiQuery({
    name: 'period',
    enum: ['week', 'month', 'quarter'],
    required: false,
  })
  spending(@CurrentUser() user: RequestUser, @Query('period') period: InsightPeriod = 'month') {
    return this.svc.spending(user.id, period);
  }

  @Get('budget-adherence')
  @ApiOperation({ summary: 'Per-budget spent vs limit' })
  budgetAdherence(@CurrentUser() user: RequestUser) {
    return this.svc.budgetAdherence(user.id);
  }
}
