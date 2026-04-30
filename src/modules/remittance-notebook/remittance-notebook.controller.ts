import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RemittanceNotebookService } from './remittance-notebook.service';

@Controller('remittance-notebook')
export class RemittanceNotebookController {
  constructor(private readonly service: RemittanceNotebookService) {}

  @Get()
  async findAll(
    @CurrentUser('sub') userId: string,
    @Query('status') status?: string,
  ) {
    if (status) return this.service.findByStatus(userId, status);
    return this.service.findAll(userId);
  }

  @Get('summary')
  async getSummary(@CurrentUser('sub') userId: string) {
    return this.service.getSummary(userId);
  }

  @Post()
  async create(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      recipientName: string;
      recipientCountry?: string;
      relationship?: string;
      provider: string;
      sourceCurrency: string;
      targetCurrency?: string;
      sourceAmountMinor: number;
      targetAmountMinor?: number;
      feeMinor?: number;
      fxRate?: number;
      deliveryMethod?: string;
      status?: string;
      plannedDate?: string;
      notes?: string;
    },
  ) {
    return this.service.create(userId, body);
  }

  @Patch(':id')
  async update(
    @CurrentUser('sub') userId: string,
    @Param('id') entryId: string,
    @Body() body: Partial<any>,
  ) {
    return this.service.update(userId, entryId, body);
  }

  @Patch(':id/mark-sent')
  async markSent(
    @CurrentUser('sub') userId: string,
    @Param('id') entryId: string,
  ) {
    return this.service.markAsSent(userId, entryId);
  }

  @Patch(':id/mark-received')
  async markReceived(
    @CurrentUser('sub') userId: string,
    @Param('id') entryId: string,
  ) {
    return this.service.markAsReceived(userId, entryId);
  }

  @Delete(':id')
  async delete(
    @CurrentUser('sub') userId: string,
    @Param('id') entryId: string,
  ) {
    return this.service.delete(userId, entryId);
  }
}
