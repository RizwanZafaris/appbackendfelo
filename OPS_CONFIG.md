# Felo Backend — Ops Config (credentials & secrets)

> Everything here is what Engineering **cannot** code — values that come
> from external vendors, CI secret stores, or platform infra. Treat each
> row as a P0 launch blocker until the responsible team checks it off and
> records the secret in the production secret store.
>
> Secret store of record: **AWS Secrets Manager** (production) /
> **GitHub Actions encrypted secrets** (CI). Never commit a populated
> `.env*` file.
>
> The application refuses to boot in production until every required key
> is set AND `FELO_LAUNCH_READY=1`. See `src/config/config.ts`.

| Status legend | |
|---|---|
| ☐ | Not yet provisioned |
| ⏳ | Provisioned, awaiting rotation/sign-off |
| ✅ | Provisioned, in secret store, validated |

---

## 1. Database (Supabase)

| Var | Status | Owner | Notes |
|---|---|---|---|
| `DATABASE_URL` | ☐ | Platform | **Must use port 5432 (session pool).** Port 6543 (transaction pool) breaks RLS session-local app.user_id and `configFactory` will refuse to boot. |
| `SUPABASE_URL` | ☐ | Platform | Production project URL |
| `SUPABASE_PUBLISHABLE_KEY` | ☐ | Platform | Anon-tier key (safe to ship to mobile) |
| `SUPABASE_SECRET_KEY` | ☐ | Platform | Service-role key. Use **only** for backend ops not bound by RLS. Rotate every 90 days. |
| `SUPABASE_JWKS_URL` | ☐ | Platform | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_LEGACY_JWT_SECRET` | ⏳ | Platform | Leave empty once ECC cutover is complete. |

## 2. Observability

| Var | Status | Owner | Notes |
|---|---|---|---|
| `SENTRY_DSN` | ☐ | Observability | Required in prod; configFactory rejects empty |
| `POSTHOG_API_KEY` | ☐ | Growth | Optional |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ☐ | Observability | Optional, recommended |

## 3. Encryption / KMS

| Var | Status | Owner | Notes |
|---|---|---|---|
| `SECRET_CIPHER_KEY` | ☐ | Security | 32 bytes hex. Required when KMS_KEY_ARN unset. |
| `KMS_KEY_ARN` | ☐ | Security | AWS KMS key (envelope encryption preferred). |

## 4. Webhook signing (per-provider HMAC)

Each `WEBHOOK_SECRET_*` is the secret used to sign inbound webhook
payloads. The provider sends `X-Signature: sha256=<hex>` over the raw body
plus a 5-minute window timestamp `X-Timestamp` and a unique `X-Event-Id`.
All three are mandatory; the guard rejects calls that miss any.

| Var | Status | Owner |
|---|---|---|
| `WEBHOOK_SECRET_8B` | ☐ | Remittance |
| `WEBHOOK_SECRET_PAYMOB` | ☐ | Remittance |
| `WEBHOOK_SECRET_KHALTI` | ☐ | Remittance |
| `WEBHOOK_SECRET_SAFEPAY` | ☐ | Remittance |
| `WEBHOOK_SECRET_HRC_UBL` | ☐ | Remittance |
| `WEBHOOK_SECRET_HABIB_METRO` | ☐ | Remittance |
| `WEBHOOK_SECRET_SAMSARA` | ☐ | Remittance |

## 5. Compliance vendors

| Var | Status | Owner | Notes |
|---|---|---|---|
| `SANCTIONS_PROVIDER` | ☐ | Compliance | `complyadvantage` \| `refinitiv`. **Must not be `stub` in prod** — configFactory rejects it. |
| `SANCTIONS_API_KEY` | ☐ | Compliance | |
| `SANCTIONS_API_URL` | ☐ | Compliance | |
| `KYC_PROVIDER` | ☐ | Compliance | `sumsub` \| `onfido` \| `persona` |
| `KYC_API_KEY` | ☐ | Compliance | |
| `KYC_API_URL` | ☐ | Compliance | |

## 6. Communications

| Var | Status | Owner | Notes |
|---|---|---|---|
| `SMS_PROVIDER` | ☐ | Identity | `twilio` \| `vonage` |
| `SMS_API_KEY` | ☐ | Identity | |
| `SMS_FROM_NUMBER` | ☐ | Identity | E.164 format |
| `FCM_SERVER_KEY` | ☐ | Mobile | Server key from Firebase project |
| `FCM_PROJECT_ID` | ☐ | Mobile | |

## 7. Network / ingress

| Var | Status | Owner | Notes |
|---|---|---|---|
| `CORS_ORIGINS` | ☐ | Platform | Comma-separated. Must NOT contain `*` — configFactory rejects it. |
| `TRUST_PROXY_CIDRS` | ☐ | Platform | CIDR(s) of the load balancer. Empty = loopback only (i.e. NOT behind a proxy). |
| Domain + TLS cert | ☐ | Platform | A+ on SSL Labs; HSTS preload submitted |
| WAF rules | ☐ | Platform | Standard OWASP CRS at minimum |

## 8. Coach LLM (set whichever vendor is active)

| Var | Status | Owner |
|---|---|---|
| `ANTHROPIC_API_KEY` | ☐ | Intelligence |
| `OPENAI_API_KEY` | ☐ | Intelligence |
| `GEMINI_API_KEY` | ☐ | Intelligence |
| `DEEPSEEK_API_KEY` | ☐ | Intelligence |

## 9. Mobile (delivered via CI artifacts, not env)

| Item | Status | Owner | Notes |
|---|---|---|---|
| Android upload keystore (.jks) | ☐ | Mobile | In CI secret store; `FELO_REQUIRE_RELEASE_SIGNING=1` |
| iOS distribution cert + provisioning profile | ☐ | Mobile | Auto-managed via Fastlane match preferred |
| Firebase `google-services.json` | ☐ | Mobile | Per flavor (staging, prod) |
| Firebase `GoogleService-Info.plist` | ☐ | Mobile | Per flavor |
| App Links domain `assetlinks.json` published | ☐ | Mobile | `https://<domain>/.well-known/assetlinks.json` |
| Universal Links `apple-app-site-association` published | ☐ | Mobile | |

## 10. CI / supply chain

| Item | Status | Owner |
|---|---|---|
| Branch protection on `main` (required reviews + green CI) | ☐ | Platform |
| `GITLEAKS_LICENSE` (org-wide) | ☐ | Security |
| Snyk / Dependabot enabled | ☐ | Security |
| SBOM publishing target | ☐ | Security |

---

## 11. Rotation cadence

| Secret | Rotation | Owner |
|---|---|---|
| `SUPABASE_SECRET_KEY` | 90 days | Platform |
| `SECRET_CIPHER_KEY` (or KMS DEK) | 180 days, automatic via KMS | Security |
| `WEBHOOK_SECRET_*` | 90 days, coordinated with provider | Remittance |
| Vendor API keys (sanctions, KYC, SMS) | per vendor policy, ≤ 365 days | Owner |
| Android/iOS signing certs | per platform expiry | Mobile |

## 12. Final boot gate

After every row above is ✅, the deployer sets:

```
FELO_LAUNCH_READY=1
```

…in the production environment store. Any subsequent boot in production
without this flag (e.g. an accidental rollback) fails closed.
