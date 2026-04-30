import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { fxRates, fxSeededRates, remittanceProviders, remittanceQuotes } from '@db/schema';
import { FX_PROVIDER, FxProvider } from '@/integrations/fx/fx-provider.port';

import { GetRateQueryDto, GetQuotesQueryDto } from './dto/fx-rates.dto';

const CACHE_TTL_MS = 60_000; // 60 seconds

@Injectable()
export class FxRatesService {
  private readonly logger = new Logger(FxRatesService.name);
  private readonly cache = new Map<string, { rate: number; expiresAt: number }>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    @Inject(FX_PROVIDER) private readonly fxProvider: FxProvider,
  ) {}

  /** Get live FX rate for a pair with source indicator. */
  async getRate(pair: string): Promise<{
    pair: string;
    rate: number;
    inverseRate: number;
    sourceIndicator: string;
    provider: string;
    cached: boolean;
    expiresAt: string | null;
  }> {
    const normalizedPair = pair.toUpperCase();

    // Check memory cache first
    const cached = this.cache.get(normalizedPair);
    if (cached && cached.expiresAt > Date.now()) {
      const seeded = await this.getSeededRate(normalizedPair);
      return {
        pair: normalizedPair,
        rate: cached.rate,
        inverseRate: 1 / cached.rate,
        sourceIndicator: 'cached',
        provider: this.fxProvider.name,
        cached: true,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      };
    }

    // Fetch from provider
    const liveRate = await this.fxProvider.fetchRate(normalizedPair);
    if (liveRate) {
      // Store in DB and cache
      await this.persistRate(liveRate);
      this.cache.set(normalizedPair, {
        rate: liveRate.rate,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return {
        pair: liveRate.pair,
        rate: liveRate.rate,
        inverseRate: liveRate.inverseRate,
        sourceIndicator: liveRate.sourceIndicator,
        provider: liveRate.provider,
        cached: false,
        expiresAt: liveRate.expiresAt?.toISOString() ?? null,
      };
    }

    // Fallback to seeded rate
    const seeded = await this.getSeededRate(normalizedPair);
    if (seeded) {
      return {
        pair: normalizedPair,
        rate: seeded.rate,
        inverseRate: 1 / seeded.rate,
        sourceIndicator: 'seeded',
        provider: 'seeded',
        cached: false,
        expiresAt: null,
      };
    }

    // Ultimate fallback
    return {
      pair: normalizedPair,
      rate: 0,
      inverseRate: 0,
      sourceIndicator: 'fallback',
      provider: 'none',
      cached: false,
      expiresAt: null,
    };
  }

  /** Get remittance quotes for corridor + amount. */
  async getQuotes(dto: GetQuotesQueryDto) {
    const { source, target, amountMinor } = dto;

    // Fetch from FX provider (builds quotes for known remittance providers)
    const providerQuotes = await this.fxProvider.buildQuotes(
      source,
      target,
      amountMinor,
    );

    // Enrich with provider metadata
    const enriched = await Promise.all(
      providerQuotes.map(async (quote) => {
        const provider = await this.db.query.remittanceProviders.findFirst({
          where: and(
            eq(remittanceProviders.code, quote.providerCode),
            eq(remittanceProviders.isActive, true),
          ),
        });

        return {
          ...quote,
          providerName: provider?.name ?? quote.providerCode,
          deliveryMethods: (provider?.deliveryMethods ?? []) as string[],
          speedHoursMin: provider?.speedHoursMin ?? null,
          speedHoursMax: provider?.speedHoursMax ?? null,
        };
      }),
    );

    // Store quote history
    for (const quote of providerQuotes) {
      await this.db.insert(remittanceQuotes).values({
        userId: dto.userId ?? 'anonymous',
        providerCode: quote.providerCode,
        sourceCurrency: quote.sourceCurrency,
        targetCurrency: quote.targetCurrency,
        sourceAmountMinor: quote.sourceAmountMinor,
        targetAmountMinor: quote.targetAmountMinor,
        feeMinor: quote.feeMinor,
        fxRate: quote.fxRate.toFixed(10),
        speedHours: quote.speedHours,
      });
    }

    return {
      source: source.toUpperCase(),
      target: target.toUpperCase(),
      amountMinor,
      quotes: enriched,
    };
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async persistRate(entry: {
    pair: string;
    rate: number;
    inverseRate: number;
    provider: string;
    sourceIndicator: string;
    expiresAt?: Date;
  }) {
    try {
      await this.db.insert(fxRates).values({
        pair: entry.pair,
        rate: entry.rate.toFixed(10),
        inverseRate: entry.inverseRate.toFixed(10),
        provider: entry.provider,
        sourceIndicator: entry.sourceIndicator as 'live' | 'cached' | 'seeded' | 'fallback',
        expiresAt: entry.expiresAt ?? new Date(Date.now() + CACHE_TTL_MS),
      });
    } catch (err) {
      this.logger.warn(`Failed to persist rate: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async getSeededRate(pair: string): Promise<{ rate: number } | null> {
    const row = await this.db.query.fxSeededRates.findFirst({
      where: eq(fxSeededRates.pair, pair),
    });
    if (!row) return null;
    return { rate: parseFloat(String(row.rate)) };
  }
}
