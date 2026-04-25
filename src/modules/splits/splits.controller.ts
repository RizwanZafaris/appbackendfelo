import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CreateSplitDto, MarkPaidDto, ParticipantInputDto, UpdateSplitDto } from './dto/split.dto';
import { SplitsService } from './splits.service';

@ApiTags('splits')
@ApiBearerAuth()
@Controller('splits')
export class SplitsController {
  constructor(private readonly svc: SplitsService) {}

  @Get()
  @ApiOperation({ summary: 'List splits owned by the current user' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail of a split with participants' })
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a split (with optional participants up-front)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSplitDto) {
    return this.svc.create(user.id, dto);
  }

  @Post(':id/participants')
  @ApiOperation({ summary: 'Add a single participant to an existing split' })
  addParticipant(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ParticipantInputDto,
  ) {
    return this.svc.addParticipant(user.id, id, dto);
  }

  @Patch(':id/participants/:participantId')
  @ApiOperation({ summary: 'Mark a participant paid / unpaid' })
  setParticipantPaid(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.svc.setParticipantPaid(user.id, id, participantId, dto.paid);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a split' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSplitDto,
  ) {
    return this.svc.update(user.id, id, dto);
  }

  @Post(':id/settle')
  @ApiOperation({ summary: 'Mark whole split as settled (and all participants paid)' })
  settle(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.settle(user.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a split' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user.id, id);
  }
}
