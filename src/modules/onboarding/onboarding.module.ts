import { Module } from '@nestjs/common';

import { DbModule } from '@/common/db/db.module';

import { JourneyConfigService } from './journey-config.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingStateService } from './onboarding-state.service';

/**
 * Onboarding v2 module.
 *
 * Owns:
 * - GET  /v1/onboarding/journey-config  (E9 — D-029 DB-driven content)
 * - POST /v1/onboarding/sessions        (E11 — start session)
 * - GET  /v1/onboarding/sessions/me     (E11 — resume)
 * - PATCH /v1/onboarding/state          (E11 — D-009 write-on-Continue)
 *
 * Out of scope at this checkpoint:
 * - POST /v1/onboarding/complete        (E7 Phase 7 — orchestrates final
 *   profile/budget/goals/dashboard build)
 * - POST /v1/onboarding/region/resolve  (E2 Phase 2 — IP→country lookup)
 *
 * Both ship with their respective phase epics.
 */
@Module({
  imports: [DbModule],
  controllers: [OnboardingController],
  providers: [OnboardingStateService, JourneyConfigService],
  exports: [OnboardingStateService, JourneyConfigService],
})
export class OnboardingModule {}
