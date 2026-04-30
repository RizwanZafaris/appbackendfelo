import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CashEnvelopesService } from './cash-envelopes.service';

@Controller('cash-envelopes')
export class CashEnvelopesController {
  constructor(private readonly service: CashEnvelopesService) {}

  @Get()
  async findAll(@CurrentUser('sub') userId: string) {
    return this.service.findAll(userId);
  }

  @Post()
  async create(
    @CurrentUser('sub') userId: string,
    @Body() body: { name: string; category: string; budgetMinor: number; currency?: string; period?: string },
  ) {
    return this.service.create(userId, body);
  }

  @Patch(':id/spend')
  async spend(
    @CurrentUser('sub') userId: string,
    @Param('id') envelopeId: string,
    @Body() body: { amountMinor: number },
  ) {
    return this.service.spend(userId, envelopeId, body.amountMinor);
  }

  @Patch(':id')
  async update(
    @CurrentUser('sub') userId: string,
    @Param('id') envelopeId: string,
    @Body() body: Partial<{ name: string; category: string; budgetMinor: number; isActive: boolean }>,
  ) {
    return this.service.update(userId, envelopeId, body);
  }

  @Delete(':id')
  async delete(
    @CurrentUser('sub') userId: string,
    @Param('id') envelopeId: string,
  ) {
    return this.service.delete(userId, envelopeId);
  }
}
