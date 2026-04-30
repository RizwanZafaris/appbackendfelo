import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import {
  CreateInvestmentDto,
  UpdateInvestmentDto,
  UpdatePriceDto,
} from './dto/investment.dto';
import { InvestmentsService } from './investments.service';
import { MarketDataService } from './market-data.service';
import { PortfolioService } from './portfolio.service';

@ApiTags('investments')
@ApiBearerAuth()
@Controller('investments')
export class InvestmentsController {
  constructor(
    private readonly svc: InvestmentsService,
    private readonly portfolio: PortfolioService,
    private readonly market: MarketDataService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List active holdings' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.list(user.id);
  }

  @Get('portfolio')
  @ApiOperation({
    summary: 'Aggregated portfolio with live market prices',
  })
  portfolio(@CurrentUser() user: RequestUser) {
    return this.portfolio.portfolio(user.id);
  }

  @Get('market/:symbol/quote')
  @ApiOperation({ summary: 'Live market quote for a symbol' })
  async quote(@Param('symbol') symbol: string) {
    // Uses the db from InvestmentsService via a different approach
    return this.market.fetchQuote(this.svc['db'], symbol);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Holding detail' })
  detail(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.detail(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a holding' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateInvestmentDto) {
    return this.svc.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a holding' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvestmentDto,
  ) {
    return this.svc.update(user.id, id, dto);
  }

  @Post(':id/price')
  @ApiOperation({ summary: 'Manual price refresh' })
  updatePrice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceDto,
  ) {
    return this.svc.updatePrice(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a holding' })
  archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.archive(user.id, id);
  }
}
