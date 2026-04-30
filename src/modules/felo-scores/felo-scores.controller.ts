import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { FeloScoresService } from './felo-scores.service';

@ApiTags('felo-scores')
@ApiBearerAuth()
@Controller('felo-scores')
export class FeloScoresController {
  constructor(private readonly svc: FeloScoresService) {}

  @Get('latest')
  @ApiOperation({ summary: 'Most recent Felo Score for the current user' })
  latest(@CurrentUser() user: RequestUser) {
    return this.svc.latest(user.id);
  }

  @Get('history')
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({ summary: 'Felo Score history (last N calculations)' })
  history(@CurrentUser() user: RequestUser, @Query('limit') limit?: string) {
    return this.svc.history(user.id, limit ? parseInt(limit, 10) : 30);
  }

  @Get('breakdown')
  @ApiOperation({ summary: 'Felo Score breakdown with weights and components' })
  breakdown(@CurrentUser() user: RequestUser) {
    return this.svc.breakdown(user.id);
  }
}
