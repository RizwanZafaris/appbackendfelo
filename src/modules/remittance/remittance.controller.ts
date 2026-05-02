import { Request } from 'express';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';
import { PayoutProviderFactory } from './providers/provider-factory.service';
import { RemittanceService } from './remittance.service';

import { RemittanceQuoteDto, InitiatePayoutDto } from './dto/remittance.dto';

import { WebhookSignatureService } from '@/common/webhook/webhook-signature.service';

@ApiTags('remittance')
@Controller('remittance')
@UseGuards(SupabaseJwtGuard)
export class RemittanceController {
  constructor(
    private readonly factory: PayoutProviderFactory,
    private readonly service: RemittanceService,
    private readonly webhookSignature: WebhookSignatureService,
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
    const rawBody = (req as any).rawBody || JSON.stringify(body);
    const signature = req.headers['x-webhook-signature'] as string ||
                      req.headers['stripe-signature'] as string;
    
    // In production, verify webhook signature
    if (process.env.NODE_ENV === 'production' && signature) {
      const secret = process.env[`${providerCode.toUpperCase()}_WEBHOOK_SECRET`];
      if (secret) {
        const isValid = this.webhookSignature.verifySignature(
          rawBody,
          signature,
          secret,
          providerCode,
        );
        if (!isValid) {
          throw new UnauthorizedException('Invalid webhook signature');
        }
      }
    }

    return this.service.handleWebhook(providerCode, body, req.headers);
  }
}
