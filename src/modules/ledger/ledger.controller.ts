import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Length, MaxLength, MinLength, ValidateNested } from 'class-validator';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { CursorPaginationParams } from '@/common/pagination';
import { RequestUser } from '@/common/types/request-user';

import { LedgerLine, LedgerService } from './ledger.service';

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

  /** Caller-supplied idempotency key. Falls back to Idempotency-Key header. */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

class ReverseEntryDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

@Controller('ledger')
@UseGuards(SupabaseJwtGuard)
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

    const headers = (req as unknown as { headers?: Record<string, string> }).headers ?? {};
    const idempotencyKey = body.idempotencyKey || headers['idempotency-key'] || '';
    if (!idempotencyKey) {
      throw new BadRequestException('idempotencyKey or Idempotency-Key header required');
    }

    const result = await this.ledgerService.postEntry({
      userId: Number(user.id),
      transactionId: body.transactionId,
      idempotencyKey,
      lines,
      ipAddress: (req as unknown as { ip?: string }).ip,
      userAgent: headers['user-agent'],
    });
    return { success: true, ...result };
  }

  @Post('reverse/:txnId')
  async reverse(
    @CurrentUser() user: RequestUser,
    @Param('txnId') txnId: string,
    @Body() body: ReverseEntryDto,
    @Req() req: Request,
  ) {
    await this.ledgerService.verifyTransactionOwnership(txnId, Number(user.id));
    const headers = (req as unknown as { headers?: Record<string, string> }).headers ?? {};
    await this.ledgerService.reverseEntry(
      Number(user.id),
      txnId,
      body.idempotencyKey,
      (req as unknown as { ip?: string }).ip,
      headers['user-agent'],
    );
    return { success: true };
  }
}
