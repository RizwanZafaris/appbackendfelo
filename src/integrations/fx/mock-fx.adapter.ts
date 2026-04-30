import { Injectable, Logger } from '@nestjs/common';

import { FxProvider, FxRateEntry, RemittanceQuoteEntry } from './fx-provider.port';

/**
 * Mock FX adapter — returns seeded rates for tests and local dev.
 */
@Injectable()
export class MockFxAdapter implements FxProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockFxAdapter.name);

  private readonly seededRates: Record<string, number> = {
    'CAD-PKR': 203.5,
    'CAD-INR': 60.85,
    'CAD-USD': 0.7342,
    'CAD-EUR': 0.6789,
    'CAD-GBP': 0.5781,
    'CAD-BDT': 86.42,
    'CAD-PHP': 42.15,
  };

  async fetchRate(pair: string): Promise<FxRateEntry | null> {
    this.logger.debug(`MockFX fetching rate for ${pair}`);
    const rate = this.seededRates[pair.toUpperCase()];
    if (!rate) return null;
    return {
      pair: pair.toUpperCase(),
      rate,
      inverseRate: 1 / rate,
      provider: this.name,
      sourceIndicator: 'seeded',
      expiresAt: new Date(Date.now() + 86_400_000), // 24h
    };
  }

  async buildQuotes(
    source: string,
    target: string,
    amountMinor: number,
  ): Promise<RemittanceQuoteEntry[]> {
    const pair = `${source.toUpperCase()}-${target.toUpperCase()}`;
    const rate = this.seededRates[pair];
    if (!rate) return [];

    const sourceAmount = amountMinor / 100;
    const targetAmountMinor = Math.round(sourceAmount * rate * 100);

    return [
      {
        providerCode: 'wise',
        sourceCurrency: source.toUpperCase(),
        targetCurrency: target.toUpperCase(),
        sourceAmountMinor: amountMinor,
        targetAmountMinor,
        feeMinor: Math.round(sourceAmount * 0.0065 * 100),
        fxRate: rate,
        speedHours: 24,
      },
      {
        providerCode: 'remitly',
        sourceCurrency: source.toUpperCase(),
        targetCurrency: target.toUpperCase(),
        sourceAmountMinor: amountMinor,
        targetAmountMinor: Math.round(targetAmountMinor * 0.99),
        feeMinor: Math.round(sourceAmount * 0.0099 * 100),
        fxRate: rate * 0.99,
        speedHours: 48,
      },
    ];
  }
}
