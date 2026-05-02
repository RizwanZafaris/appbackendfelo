import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { RequestUser } from '@/common/types/request-user';

import { PayoutProviderFactory } from './providers/provider-factory.service';
import { RemittanceService } from './remittance.service';
import { RemittanceWebhookGuard } from './remittance-webhook.guard';

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
    @Body() body: {
      corridor: string;
      amount: number;
      sourceCurrency: string;
      targetCurrency: string;
      payoutMethod: string;
    },
  ) {
    return this.service.getQuote(body);
  }

  @Throttle({ remittance: { limit: 5, ttl: 60_000 } })
  @Post('send')
  @ApiOperation({ summary: 'Initiate a remittance payout' })
  async sendRemittance(
    @CurrentUser() user: RequestUser,
    @Body() body: {
      routeId: string;
      amount: number;
      recipientName: string;
      recipientAccount: string;
      recipientPhone?: string;
      recipientBankCode?: string;
      recipientBankName?: string;
      purpose?: string;
      reference?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
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

  /**
   * Provider webhook receiver. Authenticated by RemittanceWebhookGuard
   * (HMAC + replay protection on UNIQUE(provider, event_id)) — not by the
   * Supabase JWT guard, since provider servers don't carry a user JWT.
   * The raw body is mounted by main.ts on /v1/remittance/webhook/* before
   * bodyParser.json so HMAC verification gets the unparsed bytes.
   */
  @Public()
  @UseGuards(RemittanceWebhookGuard)
  @Post('webhook/:providerCode')
  @ApiOperation({ summary: 'Receive webhooks from payout providers (signed)' })
  async handleWebhook(
    @Param('providerCode') providerCode: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.handleWebhook(providerCode, body, req.headers);
  }
}
