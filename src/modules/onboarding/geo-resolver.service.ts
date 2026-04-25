import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * IP → country resolver per D-006 + D-012.
 *
 * Production: MaxMind GeoLite2 self-hosted (lib mounted at GEOIP_DB_PATH).
 * Development: ipinfo.io public API with optional IPINFO_TOKEN for higher
 * rate limits.
 *
 * Mechanism rule: when neither env is set, returns null silently —
 * Phase 2 falls back to manual country picker per D-012. No code change
 * needed when MaxMind license arrives; just set GEOIP_DB_PATH.
 */
export interface GeoResolveResult {
  country: string | null; // ISO-3166 alpha-2
  currency: string | null;
  dialCode: string | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
}

@Injectable()
export class GeoResolverService {
  private readonly logger = new Logger(GeoResolverService.name);
  private readonly maxmindPath: string | undefined;
  private readonly ipinfoToken: string | undefined;
  private readonly mode: 'maxmind' | 'ipinfo' | 'disabled';

  // Static minimal mapping for ISO2 → currency + dial. Stage 7 cleanup
  // can pull this from `regions` table for full coverage.
  private static readonly COUNTRY_META: Record<string, { currency: string; dialCode: string }> = {
    PK: { currency: 'PKR', dialCode: '+92' },
    IN: { currency: 'INR', dialCode: '+91' },
    BD: { currency: 'BDT', dialCode: '+880' },
    NP: { currency: 'NPR', dialCode: '+977' },
    LK: { currency: 'LKR', dialCode: '+94' },
    CA: { currency: 'CAD', dialCode: '+1' },
    GB: { currency: 'GBP', dialCode: '+44' },
    US: { currency: 'USD', dialCode: '+1' },
    AE: { currency: 'AED', dialCode: '+971' },
    SA: { currency: 'SAR', dialCode: '+966' },
  };

  constructor(cfg: ConfigService) {
    this.maxmindPath = cfg.get<string>('GEOIP_DB_PATH');
    this.ipinfoToken = cfg.get<string>('IPINFO_TOKEN');
    if (this.maxmindPath) {
      this.mode = 'maxmind';
      this.logger.log(`GeoResolver = MaxMind (${this.maxmindPath})`);
    } else if (this.ipinfoToken !== undefined) {
      this.mode = 'ipinfo';
      this.logger.log(`GeoResolver = ipinfo${this.ipinfoToken ? ' (with token)' : ' (free tier)'}`);
    } else {
      this.mode = 'disabled';
      this.logger.log(
        'GeoResolver disabled — set GEOIP_DB_PATH (prod) or IPINFO_TOKEN (dev) to activate.',
      );
    }
  }

  async resolve(ip: string): Promise<GeoResolveResult> {
    // Strip IPv6 prefix from local-network mapped addresses
    const cleanIp = ip.replace(/^::ffff:/, '');
    if (this.isPrivate(cleanIp)) {
      return this.empty('low');
    }

    let country: string | null = null;

    try {
      if (this.mode === 'maxmind') {
        country = await this.resolveMaxmind(cleanIp);
      } else if (this.mode === 'ipinfo') {
        country = await this.resolveIpinfo(cleanIp);
      }
    } catch (err) {
      this.logger.warn(`Geo resolve failed: ${err instanceof Error ? err.message : err}`);
    }

    if (!country) return this.empty('unknown');

    const meta = GeoResolverService.COUNTRY_META[country];
    return {
      country,
      currency: meta?.currency ?? null,
      dialCode: meta?.dialCode ?? null,
      confidence: this.mode === 'maxmind' ? 'high' : 'medium',
    };
  }

  // -------- maxmind resolver (lazy-loaded) --------

  private maxmindReader: unknown = null;

  private async resolveMaxmind(ip: string): Promise<string | null> {
    if (!this.maxmindPath) return null;
    if (!this.maxmindReader) {
      // Lazy require — `@maxmind/geoip2-node` is an optional peer dep
      // that may not be installed in dev/test. We use Function-constructor
      // require so TypeScript doesn't try to resolve it at compile time.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const dynamicRequire: NodeRequire = eval('require');
        const mod = dynamicRequire('@maxmind/geoip2-node') as {
          Reader: { open: (path: string) => Promise<unknown> };
        };
        this.maxmindReader = await mod.Reader.open(this.maxmindPath);
      } catch (err) {
        this.logger.warn('MaxMind module not installed or DB file not openable; falling back.');
        return null;
      }
    }
    try {
      // @ts-expect-error — dynamic type
      const result = this.maxmindReader.country(ip);
      return result?.country?.isoCode ?? null;
    } catch {
      return null;
    }
  }

  // -------- ipinfo resolver --------

  private async resolveIpinfo(ip: string): Promise<string | null> {
    const url = `https://ipinfo.io/${encodeURIComponent(ip)}${
      this.ipinfoToken ? `?token=${this.ipinfoToken}` : ''
    }`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { country?: string };
    return json.country?.toUpperCase() ?? null;
  }

  // -------- helpers --------

  private isPrivate(ip: string): boolean {
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    );
  }

  private empty(confidence: GeoResolveResult['confidence']): GeoResolveResult {
    return {
      country: null,
      currency: null,
      dialCode: null,
      confidence,
    };
  }
}
