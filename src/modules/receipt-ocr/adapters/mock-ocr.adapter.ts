import { Injectable } from '@nestjs/common';

import { OcrProvider, OcrResult } from './ocr-provider.port';

/**
 * Deterministic mock used in CI / dev / e2e. Returns a small fixed
 * receipt so tests can assert structural correctness without paying
 * vendor cost or needing a network.
 */
@Injectable()
export class MockOcrAdapter implements OcrProvider {
  readonly name = 'mock';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async parse(_imageUrl: string): Promise<OcrResult> {
    return {
      merchant: 'Demo Super Market',
      totalMinor: 25430,
      currency: 'CAD',
      lineItems: [
        { name: 'Milk 2L', amountMinor: 549 },
        { name: 'Bread', amountMinor: 399 },
        { name: 'Eggs (12)', amountMinor: 599 },
      ],
      confidence: 0.95,
      rawResponse: { provider: 'mock' },
    };
  }
}
