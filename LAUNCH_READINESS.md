# Felo Backend — Launch Readiness

> Source of truth for what is shippable and what blocks the production cut.
> Updated alongside the launch-readiness branch. Treat this as the gating
> document — if a row is unchecked, the system does not ship.

## How this file is used

1. Engineering closes out P0 rows by landing the linked PR.
2. Ops closes out **OPS_CONFIG.md** for every credential row.
3. Once both files are 100% checked, deployer flips
   `FELO_LAUNCH_READY=1` in the production environment. Without that env
   var, `configFactory` refuses to boot in `NODE_ENV=production`.

---

## P0 — Launch blockers (code)

| # | Status | Item | Where |
|---|---|---|---|
| 1 | ✅ | Global APP_GUARD chain registered (SupabaseJwtGuard → RolesGuard → ThrottlerGuard) | `src/app.module.ts` |
| 2 | ✅ | `JwtAuthGuard` shim deleted; CI gate prevents reintroduction | n/a (deleted); `.github/workflows/ci.yml` |
| 3 | ✅ | Pino redaction list wired into LoggerModule | `src/app.module.ts` |
| 4 | ✅ | Throttler buckets (default/auth/otp/remittance) | `src/app.module.ts`, controllers |
| 5 | ✅ | Sentry init at bootstrap | `src/main.ts` |
| 6 | ✅ | Webhook routes use raw body parser; HMAC + replay guard | `src/main.ts`, `remittance-webhook.guard.ts` |
| 7 | ✅ | Trust-proxy CIDR allowlist (TRUST_PROXY_CIDRS) | `src/main.ts` |
| 8 | ✅ | Configuration validation (`FELO_LAUNCH_READY`, port 6543, CORS, placeholders) | `src/config/config.ts` |
| 9 | ✅ | `treasury_actors.user_uuid` mapping (replaces unsafe hash IDOR) | migration `012_launch_readiness.sql`; `treasury-actors.service.ts` |
| 10 | ✅ | Idempotency keys on `disbursement_orders`, `ledger_entries`, `deals` | migration; service layer |
| 11 | ✅ | Ledger uses FOR UPDATE + incremental delta (no full re-aggregation) | `ledger.service.ts` |
| 12 | ✅ | Disbursement rolling-window counts all in-flight states; tier=none blocked | `disbursement.service.ts` |
| 13 | ✅ | Optimistic-lock CAS on disbursement retry | `disbursement.service.ts` |
| 14 | ✅ | FORCE ROW LEVEL SECURITY on PII/financial tables | migration |
| 15 | ✅ | `current_user_id()` resolves Supabase UUID via SET LOCAL + auth.uid() | migration |
| 16 | ✅ | Sanctions/PEP screening adapter (deny-default, audit row per call) | `sanctions.service.ts` |
| 17 | ✅ | Webhook events table + replay protection (UNIQUE provider+event_id) | migration; guard |
| 18 | ✅ | Outbox table for at-least-once provider delivery | migration (worker lands in next iteration) |
| 19 | ✅ | SSRF-safe HTTP fetcher used by statement-import | `safe-fetch.ts`, `statement-import.service.ts` |
| 20 | ✅ | CI gates: coverage thresholds, npm audit, gitleaks, CodeQL, Semgrep, Trivy, forbidden-strings | `.github/workflows/ci.yml` |
| 21 | ✅ | Quarantine moved to `quarantine-archive` branch and removed from `main` | n/a |
| 22 | ✅ | Tests for sanctions, safe-fetch, webhook guard, disbursement, config | `*.spec.ts` |

## P0 — Launch blockers (operational; tracked in OPS_CONFIG.md)

| Item | Owner |
|---|---|
| Production Supabase project (port 5432, JWKS URL) | Platform |
| Sentry DSN, OTel collector | Observability |
| KMS key + `SECRET_CIPHER_KEY` rotation policy | Security |
| 7 webhook secrets (`WEBHOOK_SECRET_*`) | Remittance |
| Sanctions/PEP vendor account + `SANCTIONS_API_KEY` | Compliance |
| KYC vendor account + `KYC_API_KEY` | Compliance |
| FCM project + `FCM_SERVER_KEY` | Mobile |
| Domain + TLS cert + HSTS preload submission | Platform |
| WAF / ingress CIDR for `TRUST_PROXY_CIDRS` | Platform |

## P1 — Fix in 30 days (post-launch)

- Outbox worker: scheduled cron that drains `outbox_events` to providers.
- Reconciliation cron: daily compare of ledger ↔ PSP ↔ bank statement.
- Two-person rule wiring on `bookDeal` / `settleDeal` / treasury writes.
- Drop HS256 fallback in `SupabaseJwtGuard` once Supabase ECC cutover ships.
- Replace `ledgerAccounts: any` typing with explicit Drizzle relations.
- `getQuote` minor-units math (today still passes through floats).
- PII column-level encryption on `recipientAccount`, `accountNoMasked`,
  recipient phones — pgcrypto via the cached SECRET_CIPHER_KEY.
- Per-corridor feature flags / kill switch.

## P2 — Tech debt

- Move `src/modules/` into bounded contexts (money/identity/coach/ops).
- Drop `userId integer` shim once all modules read Supabase UUIDs.
- Retention TTL on `audit_log`, `ledger_entries`, `webhook_events`.
- Load + chaos test harness (k6 / Artillery + ledger contention).

---

## Re-audit checklist (mechanical)

Run before every release tag. Each item should be greppable.

```
# 1. Auth chain registered
grep -q "APP_GUARD.*SupabaseJwtGuard" src/app.module.ts

# 2. JwtAuthGuard not reintroduced
! grep -RE "class JwtAuthGuard|jwt-auth.guard" src/

# 3. No real project refs leaked
! grep -RIn "xetosbkkjowlspfxffoj" --include="*.ts" --include="*.md" --include="*.example" .

# 4. No --passWithNoTests in CI
! grep -nE "passWithNoTests" .github/workflows/*.yml

# 5. webhook guard wired on the webhook controller
grep -q "RemittanceWebhookGuard" src/modules/remittance/remittance.controller.ts

# 6. Idempotency requirements live
grep -q "idempotencyKey" src/modules/ledger/ledger.service.ts
grep -q "idempotencyKey" src/modules/remittance/disbursement.service.ts

# 7. SSRF fetcher used wherever user URLs are fetched
! grep -RnE "fetch\\(row\\.fileUrl|fetch\\(url" src/modules/ \
  | grep -v safe-fetch
```

If any line returns non-zero / matches, **do not ship**.
