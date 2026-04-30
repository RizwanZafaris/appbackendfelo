import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { GetQuotesQueryDto } from './dto/fx-rates.dto';
import { FxRatesService } from './fx-rates.service';

@ApiTags('fx-rates')
@ApiBearerAuth()
@Controller()
export class FxRatesController {
  constructor(private readonly svc: FxRatesService) {}

  @Get('fx/rate')
  @ApiOperation({ summary: 'Get FX rate for a currency pair' })
  @ApiQuery({ name: 'pair', example: 'CAD-PKR', description: 'Currency pair, e.g. CAD-PKR' })
  getRate(@Query('pair') pair: string) {
    return this.svc.getRate(pair ?? 'CAD-PKR');
  }

  @Get('remittance/quotes')
  @ApiOperation({ summary: 'Get remittance quotes for corridor + amount' })
  @ApiQuery({ name: 'source', example: 'CAD' })
  @ApiQuery({ name: 'target', example: 'PKR' })
  @ApiQuery({ name: 'amountMinor', example: 100000, description: 'Amount in minor units (cents/paisa)' })
  getQuotes(
    @CurrentUser() user: RequestUser,
    @Query('source') source?: string,
    @Query('target') target?: string,
    @Query('amountMinor') amountMinor?: string,
  ) {
    return this.svc.getQuotes({
      source: source ?? 'CAD',
      target: target ?? 'PKR',
      amountMinor: amountMinor ? parseInt(amountMinor, 10) : 100000,
      userId: user.id,
    });
  }
}
