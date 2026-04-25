# Onboarding module (v2)

> 🟡 **Stage 0 skeleton.** Implementation lands at Stage 7.

Owner of all writes from the new 8-phase Flutter journey
(`lib/features/onboarding_v2/`). Reads of public reference data
(`regions`, `banks`, `wallets`, etc.) can use the Supabase REST anon
key; everything that touches user state goes through this module.

## Endpoints (planned at Stage 4)

```
POST   /v1/onboarding/sessions              → start session, return session_id
GET    /v1/onboarding/sessions/me           → resume in-flight session
PATCH  /v1/onboarding/state                 → write OnboardingState delta (every step)
POST   /v1/onboarding/region/resolve        → IP → country/currency/timezone
POST   /v1/onboarding/personalize           → Phase 7: build dashboard config
POST   /v1/onboarding/complete              → mark done; cascade-create profile/budget/goals
GET    /v1/onboarding/funnel/dropoff        → admin-only funnel query
```

## Dependencies

- `SmsVerificationModule` (peer) — for Phase 1 OTP
- `ProfilesModule` (existing) — extend on completion
- `BudgetsModule` + `GoalsModule` (existing) — receive Phase 5 data
- `NotificationsModule` (existing) — Phase 7 fires welcome notification

## Tables touched

Additive — see `db/supabase/006_onboarding_v2.sql` (Stage 4).
