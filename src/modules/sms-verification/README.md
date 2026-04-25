# SMS Verification module — pluggable corridor adapter

> 🟡 **Stage 0 skeleton.** Provider implementations land at Stage 7.

Per Decisions **D-005**, **D-006**, **D-007** (`docs/decision-log.md` in
`appuifelo`):

- SMS OTP delivery is **not** a single-vendor choice (D-005)
- Routing is keyed on **IP-detected location first**, E.164 prefix as
  fallback (D-006)
- The vendor names below are **placeholders** until procurement closes (D-007)

We use the **Strategy pattern**: one `SmsProvider` interface + N adapters,
the registry resolves "which provider for this user" at request time using
two-key routing.

## Architecture

```
SmsService.sendOtp({phoneE164, locale, ipDetectedCountry?})
    │
    ├─ Routing decision (two-key, priority order):
    │     1. ipDetectedCountry         ── primary (set by Phase 2 resolver)
    │     2. E.164 prefix → country    ── fallback if IP unavailable
    │     3. universal fallback        ── if neither yields a provider
    │
    ├─ SmsProviderRegistry.for(country)  → returns SmsProvider
    │
    └─ provider.send({phone, code, locale, senderId})
        │
        ├─ Twilio        ── universal fallback + default for diaspora
        │                   corridors (CA / UK / US) — placeholder, may be
        │                   replaced by an active vendor discussion outcome
        ├─ <PK_VENDOR>   ── Pakistan (placeholder for active discussion)
        ├─ <IN_VENDOR>   ── India (DLT-registered required by TRAI)
        ├─ <AE_VENDOR>   ── UAE (TRA sender-ID whitelisting required)
        ├─ <SA_VENDOR>   ── Saudi (CITC compliance)
        ├─ <BD_VENDOR>   ── Bangladesh
        ├─ <NP_VENDOR>   ── Nepal
        ├─ <LK_VENDOR>   ── Sri Lanka
        └─ ConsoleLogger ── dev mode (logs OTP to stdout, never sends)
```

**Vendor names are placeholders.** Per D-007, the architecture commits to
the Strategy pattern + registry; specific providers self-register via DI
tokens once procurement closes. Adding a new corridor adapter is a new
file + module manifest entry — no changes to the routing layer.

## Why IP-based routing (not just E.164)?

D-006 lays out the reasoning. Summary:

- **Resident user** (IP=PK, phone=PK) → local provider, cheap
- **Diaspora signing up at home** (IP=CA, phone=CA) → diaspora provider, cheap
- **Diaspora with home-country SIM** (IP=CA, phone=PK) → diaspora provider
  delivers internationally; matches user expectations of "the SMS arrives
  on this device wherever it is"
- **Resident traveling abroad** (IP=AE, phone=PK) → AE provider attempts
  international delivery; if it fails, user falls back to email/in-app
  verification

The cost penalty for the few diaspora-with-foreign-SIM cases is acceptable.
Routing pure-E.164 would push diaspora users through their home-country
local vendor for inbound international SMS — strictly more expensive in
deliverability terms.

## Why not Twilio everywhere?

Twilio works in 100+ countries but:

- **India** — TRAI's DLT requires every OTP template to be pre-registered
  with the local carrier; Twilio's India route adds latency and cost vs
  MSG91 / Gupshup which handle DLT natively
- **Pakistan** — PTA-registered local senders (Veevotech, Branded SMS)
  deliver in 2-3 seconds; Twilio routes via international gateway and can
  take 30s+ during peak
- **UAE / Saudi** — TRA / CITC require sender-ID whitelisting; local
  vendors (Karix, Msegat) handle this natively
- **Cost** — local vendors are 5-10× cheaper per SMS in their home
  corridor

## Why not Supabase Auth phone OTP?

Supabase Auth supports phone OTP via Twilio (paid) or MessageBird. Same
single-vendor constraint as above. Also — we want the OTP flow tightly
coupled to the onboarding session for analytics traceability (each OTP
event carries its FR ID), which Supabase's built-in flow doesn't expose.

## Provider interface

```typescript
// src/modules/sms-verification/providers/sms-provider.interface.ts (Stage 4)

export interface SmsSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: { code: string; message: string };
}

export interface SmsProvider {
  /** ISO-3166 country codes this provider serves. */
  readonly serves: readonly string[];

  /** Provider name for logs/analytics ('twilio', 'msg91', etc.) */
  readonly name: string;

  send(params: {
    phoneE164: string;
    otpCode: string;
    locale: 'en' | 'ur' | 'hi' | 'bn' | 'ne' | 'si' | 'ar';
    /** Per-corridor branded sender ID (e.g., "FELO" or DLT-registered ID) */
    senderId?: string;
  }): Promise<SmsSendResult>;
}
```

## Registry (env-driven loading)

```typescript
// src/modules/sms-verification/sms-provider.registry.ts (Stage 4)

@Injectable()
export class SmsProviderRegistry {
  private readonly byCountry = new Map<string, SmsProvider>();

  constructor(@Inject(SMS_PROVIDERS) providers: SmsProvider[]) {
    for (const p of providers) {
      for (const c of p.serves) {
        this.byCountry.set(c, p);
      }
    }
  }

  for(countryIso: string): SmsProvider {
    return this.byCountry.get(countryIso) ?? this.fallback();
  }
}
```

Providers register themselves at module init based on env presence:

```
SMS_TWILIO_ACCOUNT_SID=...        → enables TwilioProvider for CA/UK/US
SMS_MSG91_AUTH_KEY=...            → enables Msg91Provider for IN
SMS_VEEVOTECH_API_KEY=...         → enables VeevotechProvider for PK
SMS_KARIX_API_KEY=...             → enables KarixProvider for AE
SMS_MSEGAT_USERNAME=...           → enables MsegatProvider for SA
SMS_DEV_LOGGER=true               → enables ConsoleLogger for all (dev only)
```

If no provider is registered for a country, `for()` returns `fallback()`
which logs a warning and uses Twilio (or fails outright in prod).

## OTP storage + verification

OTP codes themselves never live in the SMS provider — they're generated
+ stored in a `phone_otp_challenges` table (added in `006_…sql`) keyed
by phone + 6-digit code, with TTL (5 min default), max-attempts (3),
and replay protection (used codes are deleted, not just marked).

## Endpoints (planned at Stage 4)

```
POST /v1/sms/otp/send    { phoneE164, locale }
                         → { challengeId, expiresAt, providerName, maskedPhone }
POST /v1/sms/otp/verify  { challengeId, code }
                         → { ok, signupToken? }   // signupToken consumed by /onboarding/sessions
```

The `signupToken` is a short-lived one-time JWT that lets the next call
to `/v1/onboarding/sessions` create the auth.users row without a second
SMS round-trip.

## Stage 0 scope

This README only. Provider implementations + module wiring at Stage 7.
