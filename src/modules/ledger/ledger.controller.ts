import { Controller, Get, Post, Param, Query, UseGuards, Req, Body } from '@nestjs/common';
import { LedgerService, LedgerLine } from './ledger.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';
import { CursorPaginationParams } from '@/common/pagination';
import { IsString, IsInt, IsOptional, IsArray, ValidateNested, Length } from 'class-validator';
import { Type } from 'class-transformer';

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
    return this.ledgerService.getUserChartOfAccounts(Number(user.id), query);
  }

  @Get('accounts/:id/balance')
  async getBalance(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    const accountId = Number(id);
    // Ownership check: verify account belongs to requesting user
    await this.ledgerService.verifyAccountOwnership(accountId, Number(user.id));
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
      Number(user.id),
      body.transactionId,
      lines,
      req.ip,
      req.headers['user-agent'],
    );

    return { success: true };
  }

  @Post('reverse/:txnId')
  async reverse(
    @CurrentUser() user: RequestUser,
    @Param('txnId') txnId: string,
    @Req() req: Request,
  ) {
    // Ownership check: verify all original entries belong to requesting user's accounts
    await this.ledgerService.verifyTransactionOwnership(txnId, Number(user.id));
    await this.ledgerService.reverseEntry(
      Number(user.id),
      txnId,
      req.ip,
      req.headers['user-agent'],
    );
    return { success: true };
  }
}
