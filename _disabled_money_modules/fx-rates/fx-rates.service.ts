import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { fxOverrides, fxRates, remittanceProviders } from '@db/schema';

const FALLBACK_RATES: Record<string, number> = {
  'CAD-PKR': 205.5,
  'USD-PKR': 278.3,
  'GBP-PKR': 352.1,
  'EUR-PKR': 301.7,
  'AED-PKR': 75.8,
  'SAR-PKR': 74.2,
  'CAD-USD': 0.738,
  'USD-CAD': 1.355,
};

@Injectable()
export class FxRatesService {
  private readonly cache = new Map<string, { rate: number; expiresAt: number }>();

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async getRate(baseCurrency: string, targetCurrency: string) {
    const pair = `${baseCurrency}-${targetCurrency}`;
    const now = Date.now();
    const cached = this.cache.get(pair);
    if (cached && cached.expiresAt > now) {
      return { rate: cached.rate, source: 'cache', pair };
    }

    // Active operator override
    const overrides = await this.db
      .select()
      .from(fxOverrides)
      .where(
        and(
          eq(fxOverrides.pair, pair),
          sql`${fxOverrides.effectiveFrom} <= ${new Date()}`,
          sql`(${fxOverrides.effectiveTo} IS NULL OR ${fxOverrides.effectiveTo} >= ${new Date()})`,
        ),
      )
      .orderBy(desc(fxOverrides.effectiveFrom))
      .limit(1);
    if (overrides[0] && overrides[0].approvedBy) {
      const rate = parseFloat(overrides[0].rate);
      this.cache.set(pair, { rate, expiresAt: now + 60_000 });
      return { rate, source: 'operator_override', pair, marginBps: 0 };
    }

    // Recent market rate
    const recent = await this.db
      .select()
      .from(fxRates)
      .where(
        and(
          eq(fxRates.pair, pair),
          sql`${fxRates.fetchedAt} >= ${new Date(Date.now() - 3_600_000)}`,
        ),
      )
      .orderBy(desc(fxRates.fetchedAt))
      .limit(1);
    if (recent[0]) {
      const rate = parseFloat(recent[0].rate);
      this.cache.set(pair, { rate, expiresAt: now + 60_000 });
      return { rate, source: 'market', pair, fetchedAt: recent[0].fetchedAt };
    }

    const fallback = FALLBACK_RATES[pair] ?? 1;
    this.cache.set(pair, { rate: fallback, expiresAt: now + 60_000 });
    return { rate: fallback, source: 'fallback', pair };
  }

  async getProviderQuotes(amountMinor: number, sourceCurrency: string, targetCurrency: string) {
    const providers = await this.db
      .select()
      .from(remittanceProviders)
      .where(eq(remittanceProviders.isActive, true));

    const fx = await this.getRate(sourceCurrency, targetCurrency);
    const amount = amountMinor / 100;

    const quotes = providers
      .filter((p) => {
        const pairs = (p.countryPairs as Array<{ from?: string; to?: string }>) ?? [];
        if (pairs.length === 0) return true;
        return pairs.some((cp) => cp.from === sourceCurrency && cp.to === targetCurrency);
      })
      .map((p) => {
        const fee = (p.feeStructure as Record<string, number>) ?? {};
        const feeFixed = Number(fee.fixedMinor ?? 0) / 100;
        const feePercent = Number(fee.percent ?? 0);
        const spreadPct = Number(fee.fxSpreadPercent ?? 0);
        const totalFee = feeFixed + (amount * feePercent) / 100;
        const effectiveRate = fx.rate * (1 - spreadPct / 100);
        const payout = Math.max(0, amount - totalFee) * effectiveRate;
        return {
          providerId: p.id,
          providerName: p.name,
          providerCode: p.code,
          amountMinor,
          currency: sourceCurrency,
          estimatedPayoutMinor: Math.round(payout * 100),
          payoutCurrency: targetCurrency,
          totalFeeMinor: Math.round(totalFee * 100),
          fxRate: effectiveRate,
          marketRate: fx.rate,
          marginBps: Math.round((1 - effectiveRate / fx.rate) * 10000),
          etaHours: p.etaHours,
        };
      });
    return quotes.sort((a, b) => b.estimatedPayoutMinor - a.estimatedPayoutMinor);
  }

  async getProviders() {
    return this.db
      .select()
      .from(remittanceProviders)
      .where(eq(remittanceProviders.isActive, true));
  }

  async recordMarketRate(baseCurrency: string, targetCurrency: string, rate: number, source: string) {
    const pair = `${baseCurrency}-${targetCurrency}`;
    const [row] = await this.db
      .insert(fxRates)
      .values({ pair, rate: rate.toString(), source })
      .returning();
    return row;
  }
}
