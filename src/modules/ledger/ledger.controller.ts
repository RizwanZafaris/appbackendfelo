import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Length, ValidateNested } from 'class-validator';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CursorPaginationParams } from '@/common/pagination';
import { RequestUser } from '@/common/types/request-user';

import { LedgerLine, LedgerService } from './ledger.service';

function actorIdFromUuid(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) h = (h * 31 + uuid.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

class PostLineDto {
  @IsInt()
  ledgerAccountId!: number;

  @IsString()
  debitMinor!: string;

  @IsString()
  creditMinor!: string;

  @Length(3, 3)
  currency!: string;
}

class PostEntryDto {
  @IsString()
  transactionId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostLineDto)
  lines!: PostLineDto[];
}

@Controller('ledger')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get('accounts')
  async getAccounts(
    @CurrentUser() user: RequestUser,
    @Query() query: CursorPaginationParams,
  ) {
    return this.ledgerService.getUserChartOfAccounts(actorIdFromUuid(user.id), query);
  }

  @Get('accounts/:id/balance')
  async getBalance(@Param('id') id: string) {
    const accountId = Number(id);
    const balance = await this.ledgerService.getAccountBalance(accountId);
    return { accountId, balanceMinor: balance.toString() };
  }

  @Post('entries')
  async postEntry(
    @CurrentUser() user: RequestUser,
    @Body() body: PostEntryDto,
    @Req() req: Request,
  ) {
    const lines: LedgerLine[] = body.lines.map((line) => ({
      ledgerAccountId: line.ledgerAccountId,
      debitMinor: BigInt(line.debitMinor),
      creditMinor: BigInt(line.creditMinor),
      currency: line.currency,
    }));

    await this.ledgerService.postEntry(
      actorIdFromUuid(user.id),
      body.transactionId,
      lines,
      req.headers.get?.('x-forwarded-for')?.toString() || (req as any).ip,
      req.headers.get?.('user-agent')?.toString() || (req as any).headers?.['user-agent'],
    );

    return { success: true };
  }

  @Post('reverse/:txnId')
  async reverse(
    @CurrentUser() user: RequestUser,
    @Param('txnId') txnId: string,
    @Req() req: Request,
  ) {
    await this.ledgerService.reverseEntry(
      actorIdFromUuid(user.id),
      txnId,
      req.headers.get?.('x-forwarded-for')?.toString() || (req as any).ip,
      req.headers.get?.('user-agent')?.toString() || (req as any).headers?.['user-agent'],
    );
    return { success: true };
  }
}
