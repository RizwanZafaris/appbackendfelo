import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { MonthlyCloseService } from './monthly-close.service';

@Controller('monthly-close')
export class MonthlyCloseController {
  constructor(private readonly service: MonthlyCloseService) {}

  @Get()
  async getUserCloses(@CurrentUser('sub') userId: string) {
    return this.service.getUserCloses(userId);
  }

  @Get(':year/:month')
  async getClose(
    @CurrentUser('sub') userId: string,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.findOrCreate(userId, parseInt(year, 10), parseInt(month, 10));
  }

  @Get(':year/:month/checklist')
  async getChecklist(
    @CurrentUser('sub') userId: string,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.buildValidationChecklist(userId, parseInt(year, 10), parseInt(month, 10));
  }

  @Patch(':year/:month/checklist')
  async updateChecklist(
    @CurrentUser('sub') userId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Body() body: { checklist: Array<{ id: string; completed: boolean }> },
  ) {
    return this.service.updateChecklist(userId, parseInt(year, 10), parseInt(month, 10), body.checklist);
  }

  @Post(':year/:month/close')
  async closeMonth(
    @CurrentUser('sub') userId: string,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.closeMonth(userId, parseInt(year, 10), parseInt(month, 10));
  }
}
