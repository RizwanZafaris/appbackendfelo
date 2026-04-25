import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { ContributeGoalDto, CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('goals')
@ApiBearerAuth()
@Controller('goals')
export class GoalsController {
  constructor(private readonly svc: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'List goals for the current user' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get goal detail' })
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a goal' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateGoalDto) {
    return this.svc.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a goal' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.svc.update(user.id, id, dto);
  }

  @Post(':id/contributions')
  @ApiOperation({
    summary:
      'Add a contribution. Response includes milestones[] crossed (25/50/75/100) for confetti UX.',
  })
  contribute(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContributeGoalDto,
  ) {
    return this.svc.contribute(user.id, id, dto);
  }

  @Get(':id/streak')
  @ApiOperation({ summary: 'Weekly contribution streak (consecutive weeks)' })
  streak(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.streak(user.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a goal' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user.id, id);
  }
}
