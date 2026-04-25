import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly svc: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'List transactions, cursor-paginated by booked_at desc' })
  @ApiQuery({ name: 'cursor', required: false, description: 'ISO timestamp' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'category', required: false })
  list(
    @CurrentUser() user: RequestUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
  ) {
    return this.svc.list(user.id, {
      cursor,
      category,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('sync')
  @ApiOperation({ summary: 'Delta sync — rows updated after `since`' })
  @ApiQuery({ name: 'since', required: true, description: 'ISO timestamp' })
  sync(@CurrentUser() user: RequestUser, @Query('since') since: string) {
    return this.svc.syncSince(user.id, new Date(since));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single transaction' })
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a transaction (manual entry, OCR result, etc.)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransactionDto) {
    return this.svc.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a transaction (recategorize, edit merchant)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.svc.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a transaction' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user.id, id);
  }
}
