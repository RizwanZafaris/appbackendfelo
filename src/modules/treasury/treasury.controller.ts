import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RequestUser } from '@/common/types/request-user';

import { BookDealDto } from './dto/book-deal.dto';
import { CursorPaginationDto } from './dto/cursor-pagination.dto';
import { TreasuryService } from './treasury.service';

function actorIdFromUuid(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) h = (h * 31 + uuid.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

@Controller('treasury')
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Post('deals')
  async createDeal(
    @CurrentUser() user: RequestUser,
    @Body() body: BookDealDto,
    @Req() req: Request,
  ) {
    const result = await this.treasuryService.bookDeal(
      actorIdFromUuid(user.id),
      {
        sourceCurrency: body.sourceCurrency,
        targetCurrency: body.targetCurrency,
        sourceAmountMinor: BigInt(body.sourceAmountMinor),
        targetAmountMinor: BigInt(body.targetAmountMinor),
        ourRate: body.ourRate,
        marketRate: body.marketRate,
        marginBps: body.marginBps,
      },
      req.headers.get?.('x-forwarded-for')?.toString() || (req as any).ip,
      req.headers.get?.('user-agent')?.toString() || (req as any).headers?.['user-agent'],
    );
    return result;
  }

  @Post('deals/:id/settle')
  async settleDeal(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.treasuryService.settleDeal(
      actorIdFromUuid(user.id),
      Number(id),
      req.headers.get?.('x-forwarded-for')?.toString() || (req as any).ip,
      req.headers.get?.('user-agent')?.toString() || (req as any).headers?.['user-agent'],
    );
    return { success: true };
  }

  @Get('positions')
  async getPositions() {
    return this.treasuryService.getPositions();
  }

  @Get('deals')
  async listDeals(@Query() query: CursorPaginationDto) {
    return this.treasuryService.listDeals(query);
  }
}
