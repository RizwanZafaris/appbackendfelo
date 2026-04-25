import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CreateInvestmentDto, UpdateInvestmentDto, UpdatePriceDto } from './dto/investment.dto';
import { InvestmentsService } from './investments.service';

@ApiTags('investments')
@ApiBearerAuth()
@Controller('investments')
export class InvestmentsController {
  constructor(private readonly svc: InvestmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List active holdings' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.list(user.id);
  }

  @Get('portfolio')
  @ApiOperation({
    summary: 'Aggregated portfolio: cost, market value, P&L, allocation by asset class',
  })
  portfolio(@CurrentUser() user: RequestUser) {
    return this.svc.portfolio(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Holding detail' })
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
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
  @ApiOperation({ summary: 'Manual price refresh (no live feed in Phase 1)' })
  updatePrice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceDto,
  ) {
    return this.svc.updatePrice(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a holding' })
  archive(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.archive(user.id, id);
  }
}
