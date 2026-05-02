# Felo Backend — Launch flags & module wiring

This document tracks which modules are wired into `app.module.ts` for
the soft-launch v1 build, and how to re-enable the parked money-movement
modules when MSB licensing + corridor agreements land.

## Soft-launch v1 active modules

```
ConfigModule
LoggerModule (pino + redaction)
ThrottlerModule (default + auth + otp + remittance buckets)
ScheduleModule
DbModule (Drizzle)

AuthModule
HealthModule
SecurityModule
AuditModule
AuditLogModule
AnalyticsModule

ProfilesModule
OnboardingModule
SmsVerificationModule (rate-limited)
ReferralsModule

AccountsModule
TransactionsModule
BudgetsModule
CashEnvelopesModule
GoalsModule
RecurringBillsModule
SplitsModule
InsightsModule
ReportsModule
MonthlyCloseModule

RemittanceNotebookModule  ← manual log only; no money movement

ComplianceModule          ← record-keeping; SanctionsService still loaded
AdminModule (incl. LaunchReadinessModule)

ReceiptOcrModule          ← OCR adapter mocked; no vendor calls

CoachModule
FeloScoresModule

SubscriptionsModule       ← UI only; no Stripe / RevenueCat
NotificationsModule       ← in-app feed only; no FCM
FamilyModule              ← stub
InvestmentsModule         ← stub
ExportModule              ← GDPR
```

## Parked under `_disabled_money_modules/`

| Module | Why parked | Restore path |
|---|---|---|
| `LedgerModule` | Double-entry ledger; needs MSB scope | git mv back to `src/modules/ledger`; re-add import in app.module.ts |
| `TreasuryModule` | Deal book/settle; needs MSB scope | same |
| `FxRatesModule` | Live FX feed | same |
| `RemittanceModule` (incl. 7 provider adapters) | Live money movement; needs corridor agreements | same; provision `WEBHOOK_SECRET_*` per provider |
| `StatementImportModule` | Bank statement import; depends on receipt + ledger | same |

`tsconfig.json` excludes `_disabled_money_modules/` so the parked code does
not affect compile. `_disabled_money_modules/<dir>/README.md` (added when
restoring each module) should record the restoration prerequisites.

## Hard re-enable checklist (once MSB lands)

1. `git mv _disabled_money_modules/{ledger,treasury,fx-rates,remittance,statement-import} src/modules/`
2. Restore the imports in `src/app.module.ts` (the comment block points at
   the exact lines).
3. Re-add `tsconfig.json` `_disabled_money_modules` removal.
4. Provision the OPS rows now in OPS_CONFIG.md → `compliance` and
   `mobile` (sanctions vendor, KYC vendor, webhook secrets).
5. Re-run `scripts/check-prod-config.ts` against the new env.
6. Bump `FELO_LAUNCH_READY` only after each row is ✅ on the
   `/launch-readiness` ops portal page.

## Soft-launch feature flags (mobile)

Mirror in `appuifelo/lib/core/config/felo_env.dart`. All default OFF in
release:

| Flag | Effect when ON |
|---|---|
| `FELO_ENABLE_KYC` | `/kyc` route renders the real KycScreen |
| `FELO_ENABLE_INVESTMENTS` | `/investments` shows InvestmentsScreen |
| `FELO_ENABLE_SMS_PARSER` | `/sms-parser` shows SmsParserScreen |
| `FELO_ENABLE_FAMILY` | `/family` shows FamilyScreen |
| `FELO_ENABLE_LIVE_REMITTANCE` | `/remittance` no longer redirects to notebook |
