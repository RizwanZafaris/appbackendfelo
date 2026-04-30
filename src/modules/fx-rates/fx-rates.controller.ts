import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { FxRatesService } from './fx-rates.service';

@ApiBearerAuth()
@ApiTags('fx-rates')
@Controller('fx')
export class FxRatesController {
  constructor(private readonly fxRates: FxRatesService) {}

  @Get('rate')
  getRate(@Query('base') base: string, @Query('target') target: string) {
    return this.fxRates.getRate(base, target);
  }

  @Post('rate')
  recordRate(
    @Body()
    body: { baseCurrency: string; targetCurrency: string; rate: number; source: string },
  ) {
    return this.fxRates.recordMarketRate(
      body.baseCurrency,
      body.targetCurrency,
      body.rate,
      body.source,
    );
  }

  @Get('remittance/quotes')
  getQuotes(
    @Query('amountMinor') amountMinor: string,
    @Query('currency') currency: string,
    @Query('targetCurrency') targetCurrency: string,
  ) {
    return this.fxRates.getProviderQuotes(parseInt(amountMinor, 10), currency, targetCurrency);
  }

  @Get('remittance/providers')
  getProviders() {
    return this.fxRates.getProviders();
  }
}
