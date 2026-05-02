import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';
import { PayoutProviderFactory } from './providers/provider-factory.service';
import { RemittanceService } from './remittance.service';

import { RemittanceQuoteDto, InitiatePayoutDto } from './dto/remittance.dto';

@ApiTags('remittance')
@Controller('remittance')
@UseGuards(SupabaseJwtGuard)
export class RemittanceController {
  constructor(
    private readonly factory: PayoutProviderFactory,
    private readonly service: RemittanceService,
  ) {}

  @Get('routes')
  @ApiOperation({ summary: 'Get available remittance routes for a corridor' })
  async getRoutes(@Query('corridor') corridor: string) {
    return this.factory.getRoutesForCorridor(corridor);
  }

  @Get('routes/all')
  @ApiOperation({ summary: 'Get all configured routes' })
  async getAllRoutes() {
    return this.service.getAllRoutes();
  }

  @Post('quote')
  @ApiOperation({ summary: 'Get FX quote for a remittance' })
  async getQuote(
    @CurrentUser() user: RequestUser,
    @Body() body: RemittanceQuoteDto,
  ) {
    return this.service.getQuote(body);
  }

  @Post('send')
  @ApiOperation({ summary: 'Initiate a remittance payout' })
  async sendRemittance(
    @CurrentUser() user: RequestUser,
    @Body() body: InitiatePayoutDto,
  ) {
    return this.service.initiatePayout({
      userId: user.id,
      ...body,
    });
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List user remittance transactions' })
  async listTransactions(
    @CurrentUser() user: RequestUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.service.listUserTransactions(user.id, page, limit);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get remittance transaction details' })
  async getTransaction(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.service.getTransaction(id);
  }

  @Get('transactions/:id/status')
  @ApiOperation({ summary: 'Check provider status for a transaction' })
  async checkProviderStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.service.checkProviderStatus(id);
  }

  @Get('transactions/:id/receipt')
  @ApiOperation({ summary: 'Get remittance receipt' })
  async getReceipt(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.service.getReceipt(id);
  }

  @Post('webhook/:providerCode')
  @ApiOperation({ summary: 'Receive webhooks from payout providers' })
  async handleWebhook(
    @Param('providerCode') providerCode: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.handleWebhook(providerCode, body, req.headers);
  }
}
