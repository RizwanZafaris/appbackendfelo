import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import type { RequestUser } from '@/common/types/request-user';

import { CompleteService, type CompleteResult } from './complete.service';
import {
  PatchOnboardingStateDto,
  StartOnboardingSessionDto,
} from './dto/onboarding-state.dto';
import {
  GeoResolverService,
  type GeoResolveResult,
} from './geo-resolver.service';
import {
  JourneyConfigService,
  type JourneyConfigPayload,
} from './journey-config.service';
import { OnboardingStateService } from './onboarding-state.service';

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly state: OnboardingStateService,
    private readonly config: JourneyConfigService,
    private readonly geo: GeoResolverService,
    private readonly completer: CompleteService,
  ) {}

  /**
   * E2 — IP→country resolver (D-006 + D-012). Public; called pre-auth on
   * Welcome screen mount so Phase 2 can pre-fill the country card.
   */
  @Post('region/resolve')
  @Public()
  @ApiOperation({
    summary:
      'Resolve client IP to country/currency/dial-code. MaxMind (prod) or ipinfo (dev).',
  })
  async resolveRegion(@Req() req: Request): Promise<GeoResolveResult> {
    const ip =
      (req.headers['cf-connecting-ip'] as string | undefined) ??
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ??
      req.socket.remoteAddress ??
      '';
    return this.geo.resolve(ip);
  }

  /**
   * E9 — DB-driven content payload (D-029). Public — no auth needed for
   * reference reads. Cloudflare CDN caches by `version` query param.
   */
  @Get('journey-config')
  @Public()
  @ApiOperation({
    summary:
      'Returns DB-driven content for every onboarding screen (D-029). Cached by version_hash.',
  })
  async journeyConfig(
    @Query('locale') locale = 'en',
  ): Promise<JourneyConfigPayload> {
    return this.config.getPayload(locale);
  }

  /**
   * E11 — start a session. Anonymous OK (pre-auth). User_id promoted on
   * first authenticated PATCH.
   */
  @Post('sessions')
  @Public()
  @ApiOperation({ summary: 'Start a new onboarding session.' })
  async startSession(
    @Body() dto: StartOnboardingSessionDto,
    @CurrentUser() @Optional() user?: RequestUser,
  ): Promise<{ session_id: string; started_at: string }> {
    return this.state.startSession(dto.device_id, user?.id ?? null, dto.client_started_at);
  }

  /**
   * E11 — resume state for cold-start. Returns most recent
   * incomplete session + its onboarding_state row.
   */
  @Get('sessions/me')
  @ApiOperation({ summary: 'Resume in-flight session for the current user.' })
  async resume(
    @CurrentUser() user: RequestUser,
  ): Promise<{
    state: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  }> {
    return this.state.getResumeState(user.id);
  }

  /**
   * E11 — write-on-Continue PATCH (FR-11.0.2). Delta-merge. Idempotent
   * for retries.
   */
  @Patch('state')
  @ApiOperation({
    summary: 'PATCH onboarding state delta (write-on-Continue, D-009).',
  })
  async patchState(
    @Body() dto: PatchOnboardingStateDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true; updated_at: string }> {
    try {
      return await this.state.upsertState(user.id, dto);
    } catch (err) {
      // D-008 / D-013 invariants raise plain Errors; surface as 400.
      if (err instanceof Error && /^D-/.test(err.message)) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * E7 — Phase 7 personalization orchestrator (FR-7.0.1..7.0.8 / D-025).
   *
   * Idempotent. Fan-outs onboarding_state into profiles/budgets/goals/
   * accounts/corridors/dashboard_widgets in a single transaction and
   * fires the `onboarding_completed` analytics event (D-030).
   */
  @Post('complete')
  @ApiOperation({
    summary:
      'Phase 7 orchestrator: fan-out onboarding_state into product tables.',
  })
  async complete(
    @CurrentUser() user: RequestUser,
  ): Promise<CompleteResult> {
    return this.completer.complete(user.id);
  }
}
