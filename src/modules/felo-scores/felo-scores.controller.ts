import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'Felo Score history (last 30 calculations)' })
  history(@CurrentUser() user: RequestUser) {
    return this.svc.history(user.id);
  }
}
