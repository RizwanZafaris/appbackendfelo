import { Injectable, Logger } from '@nestjs/common';

import { OcrProvider, OcrResult } from './ocr-provider.port';

/**
 * Mock OCR adapter — returns deterministic fake data for tests
 * and local development without cloud credentials.
 */
@Injectable()
export class MockOcrAdapter implements OcrProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockOcrAdapter.name);

  async parse(imageUrl: string): Promise<OcrResult> {
    this.logger.debug(`MockOCR parsing: ${imageUrl}`);
    return {
      merchant: 'Mock Store',
      merchantAddress: '123 Test Street, Toronto ON',
      date: new Date().toISOString().split('T')[0],
      totalMinor: 2547, // $25.47
      currency: 'CAD',
      taxMinor: 331, // HST
      lineItems: [
        { name: 'Item A', quantity: 2, unitPriceMinor: 899, totalMinor: 1798 },
        { name: 'Item B', quantity: 1, unitPriceMinor: 749, totalMinor: 749 },
      ],
      rawText: 'MOCK STORE\n123 Test Street\nItem A x2 $8.99\nItem B x1 $7.49\nHST $3.31\nTotal $25.47',
      confidence: 0.92,
    };
  }
}
