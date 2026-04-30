import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { investments } from '@db/schema';

import { MarketDataService } from './market-data.service';

export interface PortfolioAllocation {
  assetClass: string;
  costMinor: number;
  marketMinor: number;
  weight: number;
}

export interface PortfolioSummary {
  holdings: number;
  totalCostMinor: number;
  totalMarketMinor: number | null;
  totalPnLMinor: number | null;
  anyMissingPrice: boolean;
  allocations: PortfolioAllocation[];
}

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly market: MarketDataService,
  ) {}

  async portfolio(userId: string): Promise<PortfolioSummary> {
    const rows = await this.db
      .select()
      .from(investments)
      .where(and(eq(investments.userId, userId), eq(investments.isArchived, false)))
      .orderBy(desc(investments.createdAt));

    let totalCostMinor = 0;
    let totalMarketMinor = 0;
    let anyMissingPrice = false;

    const byClass = new Map<
      string,
      { costMinor: number; marketMinor: number; pricedMarketMinor: number }
    >();

    for (const r of rows) {
      const cost = r.costBasisMinor;
      totalCostMinor += cost;

      // Refresh price from market data if stale
      let priceMinor = r.lastPriceMinor;
      if (!priceMinor || this.isStale(r.lastPricedAt)) {
        try {
          const quote = await this.market.fetchQuote(this.db, r.symbol);
          priceMinor = Math.round(quote.price * 100);
          // Update cached price
          await this.db
            .update(investments)
            .set({ lastPriceMinor: priceMinor, lastPricedAt: new Date() })
            .where(eq(investments.id, r.id));
        } catch {
          // Keep existing price
        }
      }

      const units = Number(r.units);
      const market = priceMinor != null ? Math.round(priceMinor * units) : null;
      if (market === null) {
        anyMissingPrice = true;
      } else {
        totalMarketMinor += market;
      }

      const slot = byClass.get(r.assetClass) ?? {
        costMinor: 0,
        marketMinor: 0,
        pricedMarketMinor: 0,
      };
      slot.costMinor += cost;
      slot.marketMinor += market ?? cost;
      if (market != null) slot.pricedMarketMinor += market;
      byClass.set(r.assetClass, slot);
    }

    const allocations = Array.from(byClass.entries()).map(([assetClass, v]) => ({
      assetClass,
      costMinor: v.costMinor,
      marketMinor: v.marketMinor,
      weight: totalMarketMinor === 0 ? 0 : v.pricedMarketMinor / totalMarketMinor,
    }));

    return {
      holdings: rows.length,
      totalCostMinor,
      totalMarketMinor: anyMissingPrice ? null : totalMarketMinor,
      totalPnLMinor: anyMissingPrice ? null : totalMarketMinor - totalCostMinor,
      anyMissingPrice,
      allocations,
    };
  }

  private isStale(lastPricedAt: Date | null): boolean {
    if (!lastPricedAt) return true;
    return Date.now() - lastPricedAt.getTime() > 15 * 60 * 1000; // 15 min
  }
}
