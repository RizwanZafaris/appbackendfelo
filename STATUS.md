# appbackendfelo — Status

> Last updated: 2026-04-30
> See [program dashboard](https://github.com/RizwanZafaris/felo-docs/blob/main/STATUS.md).

## Purpose
NestJS + Drizzle backend. All public API for the mobile app, all admin API for the operations portal.

## Owner squads
Capture · Remittance · Identity · Intelligence · Monetization · Ops Portal (admin module).

## Current head
- branch: `main`
- last commit: [`56a6c08`](https://github.com/RizwanZafaris/appbackendfelo/commit/56a6c08) — merge `fix/build-errors`
- log: https://github.com/RizwanZafaris/appbackendfelo/commits/main

## Modules in tree

| Module | State | Notes |
|---|---|---|
| accounts | real | full CRUD |
| analytics | real | dispatcher + sinks |
| auth | real | Supabase JWT + MFA |
| budgets | real | rollover + alerts |
| cash-envelopes | real | new in feature-coverage push |
| coach | real | LLM + 3-layer guardrails |
| export | real | GDPR export + delete |
| felo-scores | partial | algorithm stub — Sprint 1 |
| goals | real | CRUD; expense-link TODO |
| health | real | liveness + readiness |
| insights | real | spending analysis |
| investments | stub | schema only — Sprint 6 |
| monthly-close | real | checklist + lock |
| notifications | partial | needs FCM + Realtime — Sprint 5 |
| onboarding | real | 8-phase v2 + OTP |
| profiles | real | user mgmt |
| recurring-bills | real | detection + reminders |
| referrals | real | code gen + tracking |
| remittance-notebook | real | manual transfer log |
| reports | real | weekly + monthly |
| security | real | crypto + replay protection |
| sms-verification | real | OTP via SMS |
| splits | real | bill splitting |
| subscriptions | partial | needs Stripe + RevenueCat — Sprint 4 |
| transactions | real | CRUD + receipts |

## Active PRs

| PR | Title | Squad | State |
|---|---|---|---|
| _none yet_ | | | |

## Open feature branches
- `feat/onboarding-v2-stage-0`
- `feat/sprint-1-mfa-referrals`
- `feat/sprint-2-splits-investments`
- `feat/sprint-3-coach-insights`
- `feat/sprint-4-goals-notifications`
- `fix/build-errors` (merged)

## Build & test gates

| Gate | Target | Last check |
|---|---|---|
| `npm run build` | green | ✅ 2026-04-30 |
| `npm test` coverage | ≥ 70% | ~5% (gap) |

## DB migrations pending in environments

| Env | 007_feature_coverage.sql |
|---|---|
| dev | _tbd_ |
| staging | _tbd_ |
| prod | _tbd_ |

## How to update
- Backend squad-leads: update "Modules in tree" + "Active PRs" when PRs open.
- devops: update migration status when each env runs.
- All edits via PR; only Claude Code merges to `main`.
