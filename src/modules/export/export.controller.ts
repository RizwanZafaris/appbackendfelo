import { Controller, Get, Post, Delete, Body } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ExportService } from './export.service';

@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  async requestExport(
    @CurrentUser('sub') userId: string,
    @Body() body: { format: 'json' | 'csv' },
  ) {
    return this.exportService.requestExport(userId, body.format);
  }

  @Get()
  async getExports(@CurrentUser('sub') userId: string) {
    return this.exportService.getExports(userId);
  }

  @Delete('account')
  async deleteAccount(@CurrentUser('sub') userId: string) {
    await this.exportService.deleteAccountData(userId);
    return { deleted: true };
  }
}
