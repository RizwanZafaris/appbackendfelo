import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FxProvider, FxRateEntry, RemittanceQuoteEntry } from './fx-provider.port';

/**
 * Open Exchange Rates adapter — live FX data.
 *
 * Free tier: 1k requests/month, hourly updates.
 * Paid tier: real-time, unlimited.
 *
 * Env: OPEN_EXCHANGE_RATES_APP_ID
 */
@Injectable()
export class OpenExchangeRatesAdapter implements FxProvider {
  readonly name = 'open_exchange_rates';
  private readonly logger = new Logger(OpenExchangeRatesAdapter.name);
  private readonly appId: string | undefined;
  private readonly baseUrl = 'https://openexchangerates.org/api/latest.json';

  constructor(private readonly cfg: ConfigService) {
    this.appId = this.cfg.get<string>('OPEN_EXCHANGE_RATES_APP_ID');
  }

  async fetchRate(pair: string): Promise<FxRateEntry | null> {
    if (!this.appId) {
      this.logger.warn('OPEN_EXCHANGE_RATES_APP_ID not set');
      return null;
    }

    const [source, target] = pair.toUpperCase().split('-');
    if (!source || !target) return null;

    try {
      const url = `${this.baseUrl}?app_id=${this.appId}&symbols=${source},${target}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`OXR HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        rates: Record<string, number>;
        timestamp: number;
      };

      const sourceRate = data.rates[source];
      const targetRate = data.rates[target];
      if (!sourceRate || !targetRate) return null;

      // OXR returns rates relative to USD base; compute cross-rate
      const crossRate = targetRate / sourceRate;

      return {
        pair: `${source}-${target}`,
        rate: crossRate,
        inverseRate: 1 / crossRate,
        provider: this.name,
        sourceIndicator: 'live',
        expiresAt: new Date(Date.now() + 3_600_000), // 1h
      };
    } catch (err) {
      this.logger.error(`OXR fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async buildQuotes(
    source: string,
    target: string,
    amountMinor: number,
  ): Promise<RemittanceQuoteEntry[]> {
    const rateEntry = await this.fetchRate(`${source}-${target}`);
    if (!rateEntry) return [];

    const sourceAmount = amountMinor / 100;
    const targetAmountMinor = Math.round(sourceAmount * rateEntry.rate * 100);

    // Build quotes for known providers using the live rate + typical spreads
    return [
      {
        providerCode: 'wise',
        sourceCurrency: source.toUpperCase(),
        targetCurrency: target.toUpperCase(),
        sourceAmountMinor: amountMinor,
        targetAmountMinor,
        feeMinor: Math.round(sourceAmount * 0.0065 * 100),
        fxRate: rateEntry.rate,
        speedHours: 24,
      },
      {
        providerCode: 'remitly',
        sourceCurrency: source.toUpperCase(),
        targetCurrency: target.toUpperCase(),
        sourceAmountMinor: amountMinor,
        targetAmountMinor: Math.round(targetAmountMinor * 0.99),
        feeMinor: Math.round(sourceAmount * 0.0099 * 100),
        fxRate: rateEntry.rate * 0.99,
        speedHours: 48,
      },
    ];
  }
}
