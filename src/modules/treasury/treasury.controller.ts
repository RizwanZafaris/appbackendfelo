import { Controller, Get, Post, Param, Query, Body, UseGuards, Req } from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';
import { BookDealDto } from './dto/book-deal.dto';
import { CursorPaginationDto } from './dto/cursor-pagination.dto';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';

@Controller('treasury')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Post('deals')
  @Roles('treasury-operator', 'admin')
  async createDeal(
    @CurrentUser() user: RequestUser,
    @Body() body: BookDealDto,
    @Req() req: Request,
  ) {
    const result = await this.treasuryService.bookDeal(
      Number(user.id),
      {
        sourceCurrency: body.sourceCurrency,
        targetCurrency: body.targetCurrency,
        sourceAmountMinor: BigInt(body.sourceAmountMinor),
        targetAmountMinor: BigInt(body.targetAmountMinor),
        ourRate: body.ourRate,
        marketRate: body.marketRate,
        marginBps: body.marginBps,
      },
      (req as any).ip,
      (req as any).headers['user-agent'],
    );
    return result;
  }

  @Post('deals/:id/settle')
  @Roles('treasury-operator', 'admin')
  async settleDeal(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.treasuryService.settleDeal(
      Number(user.id),
      Number(id),
      (req as any).ip,
      (req as any).headers['user-agent'],
    );
    return { success: true };
  }

  @Get('positions')
  @Roles('treasury-operator', 'admin', 'viewer')
  async getPositions() {
    return this.treasuryService.getPositions();
  }

  @Get('deals')
  @Roles('treasury-operator', 'admin', 'viewer')
  async listDeals(@Query() query: CursorPaginationDto) {
    return this.treasuryService.listDeals(query);
  }
}
