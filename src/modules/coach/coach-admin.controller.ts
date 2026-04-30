import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CoachChatService } from './coach-chat.service';
import { CoachCostService } from './coach-cost.service';
import { CoachPromptService } from './coach-prompt.service';
import { GuardrailTripService } from './guardrail-trip.service';

class CreatePromptDto {
  version!: string;
  name!: string;
  systemPrompt!: string;
  isActive?: boolean;
  isCanary?: boolean;
  canaryPercent?: number;
}

class SetCanaryDto {
  percent!: number;
}

@ApiTags('admin/coach')
@ApiBearerAuth()
@Controller('admin/coach')
export class CoachAdminController {
  constructor(
    private readonly promptSvc: CoachPromptService,
    private readonly chatSvc: CoachChatService,
    private readonly costSvc: CoachCostService,
    private readonly tripSvc: GuardrailTripService,
  ) {}

  // ---- Prompt Registry ----

  @Get('prompts')
  @ApiOperation({ summary: 'List all prompt versions' })
  listPrompts() {
    return this.promptSvc.listPrompts();
  }

  @Post('prompts')
  @ApiBody({ type: CreatePromptDto })
  @ApiOperation({ summary: 'Create a new prompt version' })
  createPrompt(@Body() dto: CreatePromptDto) {
    return this.promptSvc.createPrompt(dto);
  }

  @Post('prompts/:id/activate')
  @ApiOperation({ summary: 'Set a prompt as the active version' })
  setActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.promptSvc.setActive(id);
  }

  @Post('prompts/:id/canary')
  @ApiBody({ type: SetCanaryDto })
  @ApiOperation({ summary: 'Set a prompt as canary with traffic %' })
  setCanary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCanaryDto,
  ) {
    return this.promptSvc.setCanary(id, dto.percent);
  }

  // ---- Conversation Viewer (PII-redacted) ----

  @Get('conversations/:id')
  @ApiOperation({ summary: 'View a conversation with PII redacted' })
  getConversationRedacted(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatSvc.getConversationRedacted(id);
  }

  // ---- Guardrail Trip Log ----

  @Get('guardrail-trips')
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({ summary: 'List guardrail trips' })
  listTrips(@Query('limit') limit?: string) {
    return this.tripSvc.listTrips({ limit: limit ? parseInt(limit, 10) : 100 });
  }

  @Get('guardrail-trips/stats')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOperation({ summary: 'Guardrail trip statistics' })
  tripStats(@Query('days') days?: string) {
    return this.tripSvc.tripStats(days ? parseInt(days, 10) : 7);
  }

  // ---- Cost Tracking ----

  @Get('costs/daily')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOperation({ summary: 'Daily cost summary' })
  dailyCosts(@Query('days') days?: string) {
    return this.costSvc.dailyCostSummary(days ? parseInt(days, 10) : 30);
  }
}
