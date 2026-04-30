import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Felo Score history' })
  history(
    @CurrentUser() user: RequestUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getHistory(user.id, cursor, limit ? parseInt(limit, 10) : 50);
  }

  @Get()
  current(@CurrentUser() user: RequestUser) {
    return this.svc.getScore(user.id);
  }

  @Post('compute')
  compute(@CurrentUser() user: RequestUser, @Body() body: { formulaVersion?: number }) {
    return this.svc.compute(user.id, body?.formulaVersion);
  }

  @Get('explanation')
  async explanation(@CurrentUser() user: RequestUser) {
    const score = await this.svc.getScore(user.id);
    const components = (score.components ?? {}) as Record<string, number>;
    return {
      score: score.score,
      components,
      explanations: {
        budgetAdherence: 'Percentage of budgets where spending is within limits.',
        savingsRate: 'Credit-vs-debit volume over the last 30 days.',
        billPunctuality: 'Percentage of recurring bills currently up to date.',
        debtToIncome: 'Lower debt payments relative to income is better.',
        goalProgress: 'Average completion across savings goals.',
      },
    };
  }

  @Get('formulas')
  formulas() {
    return this.svc.getFormulas();
  }

  @Post('formulas')
  createFormula(@Body() body: { version: number; weights: Record<string, number> }) {
    return this.svc.createFormula(body.version, body.weights);
  }
}
