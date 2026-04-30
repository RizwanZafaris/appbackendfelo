/**
 * FX Provider Port — adapter pattern for foreign exchange rates.
 *
 * Live rates, cached rates, and seeded (offline) rates all conform
 * to the same port so callers don't care about the source.
 */

/** A single FX rate entry. */
export interface FxRateEntry {
  pair: string; // "CAD-PKR"
  rate: number; // 1 source = rate target
  inverseRate: number;
  provider: string;
  sourceIndicator: 'live' | 'cached' | 'seeded' | 'fallback';
  expiresAt?: Date;
}

/** A remittance quote from a provider. */
export interface RemittanceQuoteEntry {
  providerCode: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmountMinor: number;
  targetAmountMinor: number;
  feeMinor: number;
  fxRate: number;
  speedHours: number | null;
}

/** Port interface — every FX adapter implements this. */
export interface FxProvider {
  /** Provider name for attribution. */
  readonly name: string;

  /** Fetch live rate for a currency pair. */
  fetchRate(pair: string): Promise<FxRateEntry | null>;

  /** Build remittance quotes for the given corridor + amount. */
  buildQuotes(
    source: string,
    target: string,
    amountMinor: number,
  ): Promise<RemittanceQuoteEntry[]>;
}

/** DI token for the active FX provider. */
export const FX_PROVIDER = Symbol('FX_PROVIDER');
