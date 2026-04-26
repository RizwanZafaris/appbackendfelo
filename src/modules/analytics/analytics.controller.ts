import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Optional,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import type { RequestUser } from '@/common/types/request-user';

import { AnalyticsDispatcher } from './analytics-dispatcher.service';
import {
  CreateEventDto,
  type CanonicalEvent,
  type DispatchResult,
} from './dto/event.dto';

/**
 * Analytics ingress — receives every event from the Flutter
 * OnboardingAnalyticsMixin and fans out via D-030 multi-sink dispatcher.
 *
 * **@Public** because pre-Phase-1 events (welcome_viewed, etc.) fire
 * before the user has an auth token. The dispatcher resolves user_id
 * from the JWT if present, else stores null. RLS on the `events` table
 * allows insert with `user_id IS NULL` for the anonymous case.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly dispatcher: AnalyticsDispatcher) {}

  @Post('event')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Dispatch an analytics event to all configured sinks (Postgres + GTM + Meta CAPI). Returns the GTM payload for client dataLayer.push.',
  })
  async dispatch(
    @Body() dto: CreateEventDto,
    @Req() req: Request,
    @CurrentUser() @Optional() user?: RequestUser,
  ): Promise<DispatchResult> {
    const event: CanonicalEvent = {
      event_name: dto.event_name,
      frd_id: dto.frd_id,
      step_id: dto.step_id,
      phase: dto.phase,
      user_id: user?.id ?? null,
      session_id: dto.session_id,
      occurred_at: dto.occurred_at,
      properties: dto.properties ?? {},
      meta: {
        user_agent: dto.meta?.user_agent ?? req.headers['user-agent'],
        locale: dto.meta?.locale,
        // ip_country resolution happens here (server-side) so the
        // raw IP never lands in the events table or any sink. For E0
        // we leave it null — Stage 7 E2 wires this to the GeoResolver.
        ip_country: undefined,
      },
    };
    return this.dispatcher.dispatch(event);
  }
}
