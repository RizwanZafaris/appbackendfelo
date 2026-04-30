import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { Drizzle } from '@/common/db/db.module';
import { marketDataCache } from '@db/schema';

export interface MarketQuote {
  symbol: string;
  price: number;
  currency: string;
  changePercent?: number;
  source: string;
  fetchedAt: Date;
}

/**
 * Market data service that fetches quotes from external providers.
 * Implements a caching layer to avoid rate limits.
 */
@Injectable()
export class MarketDataService {
  private readonly log = new Logger(MarketDataService.name);
  private readonly finnhubKey?: string;

  constructor(private readonly cfg: ConfigService) {
    this.finnhubKey = this.cfg.get<string>('FINNHUB_API_KEY');
  }

  async fetchQuote(db: Drizzle, symbol: string): Promise<MarketQuote> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache first (15-min TTL)
    const cached = await db
      .select()
      .from(marketDataCache)
      .where(eq(marketDataCache.symbol, upperSymbol));

    if (cached[0]) {
      const ageMs = Date.now() - cached[0].fetchedAt.getTime();
      if (ageMs < 15 * 60 * 1000) {
        return {
          symbol: cached[0].symbol,
          price: (cached[0].priceMinor ?? 0) / 100,
          currency: cached[0].currency ?? 'USD',
          changePercent: cached[0].changePercent ? Number(cached[0].changePercent) : undefined,
          source: cached[0].source,
          fetchedAt: cached[0].fetchedAt,
        };
      }
    }

    // Fetch from external provider
    const quote = await this.fetchFromProvider(upperSymbol);

    // Update cache
    await db
      .insert(marketDataCache)
      .values({
        symbol: upperSymbol,
        priceMinor: Math.round(quote.price * 100),
        currency: quote.currency,
        changePercent: quote.changePercent ? String(quote.changePercent) : null,
        source: quote.source,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: marketDataCache.symbol,
        set: {
          priceMinor: Math.round(quote.price * 100),
          currency: quote.currency,
          changePercent: quote.changePercent ? String(quote.changePercent) : null,
          source: quote.source,
          fetchedAt: new Date(),
        },
      });

    return quote;
  }

  private async fetchFromProvider(symbol: string): Promise<MarketQuote> {
    // Try Finnhub first
    if (this.finnhubKey) {
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${this.finnhubKey}`,
        );
        if (r.ok) {
          const data = (await r.json()) as { c: number; dp: number };
          return {
            symbol,
            price: data.c,
            currency: 'USD',
            changePercent: data.dp,
            source: 'finnhub',
            fetchedAt: new Date(),
          };
        }
      } catch (e) {
        this.log.warn(`Finnhub fetch failed for ${symbol}: ${(e as Error).message}`);
      }
    }

    // Fallback to Yahoo Finance (unofficial)
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      );
      if (r.ok) {
        const data = (await r.json()) as {
          chart: { result: Array<{ meta: { regularMarketPrice: number } }> };
        };
        const price = data.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
        return {
          symbol,
          price,
          currency: 'USD',
          source: 'yahoo',
          fetchedAt: new Date(),
        };
      }
    } catch (e) {
      this.log.warn(`Yahoo fetch failed for ${symbol}: ${(e as Error).message}`);
    }

    // Ultimate fallback
    return {
      symbol,
      price: 0,
      currency: 'USD',
      source: 'fallback',
      fetchedAt: new Date(),
    };
  }
}
