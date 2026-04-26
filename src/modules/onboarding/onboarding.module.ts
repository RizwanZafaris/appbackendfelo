import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DbModule } from '@/common/db/db.module';

import { CompleteService } from './complete.service';
import { CorridorPolicyService } from './corridor-policy.service';
import { GeoResolverService } from './geo-resolver.service';
import { JourneyConfigService } from './journey-config.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingStateService } from './onboarding-state.service';
import { OtpAttemptService } from './otp-attempt.service';

/**
 * Onboarding v2 module.
 *
 * Owns:
 * - GET  /v1/onboarding/journey-config   (E9 — D-029 DB-driven content)
 * - POST /v1/onboarding/sessions         (E11 — start session)
 * - GET  /v1/onboarding/sessions/me      (E11 — resume)
 * - PATCH /v1/onboarding/state           (E11 — D-009 write-on-Continue)
 * - POST /v1/onboarding/region/resolve   (E2 — D-006 + D-012 IP→country)
 *
 * Out of scope at this checkpoint:
 * - POST /v1/onboarding/complete         (E7 Phase 7 — orchestrates final
 *   profile/budget/goals/dashboard build) — implemented in `complete.service.ts`
 *   added in this same push.
 */
@Module({
  imports: [DbModule, ConfigModule],
  controllers: [OnboardingController],
  providers: [
    OnboardingStateService,
    JourneyConfigService,
    GeoResolverService,
    CompleteService,
    CorridorPolicyService,
    OtpAttemptService,
  ],
  exports: [
    OnboardingStateService,
    JourneyConfigService,
    GeoResolverService,
    CompleteService,
    CorridorPolicyService,
    OtpAttemptService,
  ],
})
export class OnboardingModule {}
