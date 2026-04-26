import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  SMS_PROVIDERS,
  type SmsProvider,
} from './providers/sms-provider.interface';

/**
 * SMS provider registry — D-005 + D-006 + D-007.
 *
 * Resolves: "for this user, which SmsProvider should send the OTP?"
 * Two-key routing per D-006:
 * 1. Primary: IP-detected country (set in onboarding session by Phase 2)
 * 2. Fallback: E.164 phone prefix → country
 * 3. Final fallback: ConsoleLogger (dev) or returns null (prod alert)
 *
 * Adapters self-register at NestJS module init. Inactive adapters
 * (missing env vars) appear in the constructor's input but are filtered
 * out of routing.
 */
@Injectable()
export class SmsProviderRegistry {
  private readonly logger = new Logger(SmsProviderRegistry.name);

  /** Country → first matching active provider. */
  private readonly byCountry = new Map<string, SmsProvider>();

  /** Pure-fallback providers with empty `serves` (e.g., ConsoleLogger). */
  private readonly fallbacks: SmsProvider[] = [];

  constructor(@Inject(SMS_PROVIDERS) providers: SmsProvider[]) {
    for (const p of providers) {
      if (!p.active) {
        this.logger.log(`SMS provider ${p.name} registered but INACTIVE`);
        continue;
      }
      if (p.serves.length === 0) {
        this.fallbacks.push(p);
        continue;
      }
      for (const country of p.serves) {
        // First active provider wins for a given country (deterministic
        // by registration order).
        if (!this.byCountry.has(country)) {
          this.byCountry.set(country, p);
        }
      }
    }

    const summary = providers
      .map(
        (p) =>
          `${p.name}=${p.active ? 'active' : 'inactive'}/${
            p.serves.length === 0 ? 'fallback' : p.serves.join(',')
          }`,
      )
      .join(' ');
    this.logger.log(`SmsProviderRegistry initialized — ${summary}`);
  }

  /**
   * Resolve the provider for a destination country (IP-detected or
   * E.164 prefix). Returns null only if no active provider serves the
   * country AND no fallback is registered.
   */
  for(country: string | undefined | null): SmsProvider | null {
    if (country) {
      const direct = this.byCountry.get(country.toUpperCase());
      if (direct) return direct;
    }
    if (this.fallbacks.length > 0) return this.fallbacks[0];
    return null;
  }

  /**
   * E.164 prefix → ISO-3166 alpha-2 country code. Limited mapping in v1
   * — covers the corridors the journey serves. Stage 7 cleanup may
   * pull this from `regions.dial_code` for full coverage.
   */
  static dialCodeToCountry(phoneE164: string): string | null {
    const map: Array<[string, string]> = [
      ['+92', 'PK'],
      ['+91', 'IN'],
      ['+880', 'BD'],
      ['+977', 'NP'],
      ['+94', 'LK'],
      ['+1', 'CA'], // shared CA/US — IP-based routing disambiguates
      ['+44', 'GB'],
      ['+971', 'AE'],
      ['+966', 'SA'],
    ];
    // Match longest prefix first
    map.sort((a, b) => b[0].length - a[0].length);
    for (const [prefix, country] of map) {
      if (phoneE164.startsWith(prefix)) return country;
    }
    return null;
  }
}
