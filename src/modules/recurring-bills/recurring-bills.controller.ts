import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CreateRecurringBillDto, UpdateRecurringBillDto } from './dto/recurring-bill.dto';
import { RecurringBillsService } from './recurring-bills.service';

@ApiTags('recurring-bills')
@ApiBearerAuth()
@Controller('recurring-bills')
export class RecurringBillsController {
  constructor(private readonly svc: RecurringBillsService) {}

  @Get()
  @ApiOperation({ summary: 'List active recurring bills' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a recurring bill' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateRecurringBillDto) {
    return this.svc.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring bill' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringBillDto,
  ) {
    return this.svc.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a recurring bill' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user.id, id);
  }
}
