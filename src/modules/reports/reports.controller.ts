import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('weekly')
  async getWeeklyReport(@CurrentUser('sub') userId: string) {
    return this.reportsService.generateWeeklyReport(userId);
  }

  @Get('monthly/:year/:month')
  async getMonthlyReport(
    @CurrentUser('sub') userId: string,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.reportsService.generateMonthlyReport(
      userId,
      parseInt(year, 10),
      parseInt(month, 10),
    );
  }
}
