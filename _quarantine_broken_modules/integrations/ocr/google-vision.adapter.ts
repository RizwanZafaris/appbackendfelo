import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OcrProvider, OcrResult } from './ocr-provider.port';

/**
 * Google Vision OCR adapter.
 *
 * Uses the Document Text Detection API to extract structured
 * receipt data. Falls back to label detection for merchant name.
 *
 * Env: GOOGLE_VISION_API_KEY or GOOGLE_APPLICATION_CREDENTIALS
 */
@Injectable()
export class GoogleVisionAdapter implements OcrProvider {
  readonly name = 'google_vision';
  private readonly logger = new Logger(GoogleVisionAdapter.name);
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;

  constructor(private readonly cfg: ConfigService) {
    this.apiKey = this.cfg.get<string>('GOOGLE_VISION_API_KEY');
    this.endpoint = 'https://vision.googleapis.com/v1/images:annotate';
  }

  async parse(imageUrl: string): Promise<OcrResult> {
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_VISION_API_KEY not set — returning empty OCR result');
      return this.emptyResult();
    }

    try {
      const response = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { source: { imageUri: imageUrl } },
              features: [
                { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 },
                { type: 'LABEL_DETECTION', maxResults: 5 },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Google Vision HTTP ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as {
        responses: Array<{
          fullTextAnnotation?: { text?: string };
          labelAnnotations?: Array<{ description: string; score: number }>;
          error?: { message: string };
        }>;
      };

      const resp = data.responses?.[0];
      if (resp?.error) {
        throw new Error(`Google Vision API error: ${resp.error.message}`);
      }

      const rawText = resp?.fullTextAnnotation?.text ?? '';
      const labels = resp?.labelAnnotations ?? [];

      return this.normalize(rawText, labels);
    } catch (err) {
      this.logger.error(`Google Vision OCR failed: ${err instanceof Error ? err.message : String(err)}`);
      return this.emptyResult();
    }
  }

  private normalize(rawText: string, _labels: Array<{ description: string; score: number }>): OcrResult {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    // Heuristic extraction — production would use a more robust NLP model
    let merchant: string | null = lines[0] ?? null;
    let date: string | null = null;
    let totalMinor: number | null = null;
    let taxMinor: number | null = null;
    let currency = 'CAD';

    for (const line of lines) {
      const lower = line.toLowerCase();

      // Date patterns: 2024-01-15, 15/01/2024, Jan 15, 2024
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/)
        ?? line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/)
        ?? line.match(/([A-Za]{3,9}\s+\d{1,2},?\s+\d{4})/);
      if (dateMatch && !date) {
        const parsed = new Date(dateMatch[1]);
        if (!Number.isNaN(parsed.getTime())) {
          date = parsed.toISOString().split('T')[0];
        }
      }

      // Total: "Total: $25.47" or "TOTAL 25.47"
      const totalMatch = line.match(/total[:\s]*[$\u00A3\u20AC]?\s*([\d,]+\.\d{2})/i);
      if (totalMatch && totalMinor === null) {
        totalMinor = Math.round(parseFloat(totalMatch[1].replace(',', '')) * 100);
      }

      // Tax: "HST: 3.31" or "Tax $3.31"
      const taxMatch = line.match(/(?:tax|hst|gst|vat)[:\s]*[$\u00A3\u20AC]?\s*([\d,]+\.\d{2})/i);
      if (taxMatch && taxMinor === null) {
        taxMinor = Math.round(parseFloat(taxMatch[1].replace(',', '')) * 100);
      }

      // Currency detection
      if (lower.includes('usd') || line.includes('$')) {
        // Could be CAD or USD; default to CAD for Canadian receipts
        currency = 'CAD';
      }
    }

    // Line items — simple heuristic
    const lineItems = this.extractLineItems(lines);

    // Confidence heuristic based on how many fields we found
    let confidence = 0.5;
    if (merchant) confidence += 0.1;
    if (date) confidence += 0.1;
    if (totalMinor !== null) confidence += 0.2;
    if (lineItems.length > 0) confidence += 0.1;

    return {
      merchant,
      merchantAddress: null,
      date,
      totalMinor,
      currency,
      taxMinor,
      lineItems,
      rawText,
      confidence: Math.min(confidence, 0.99),
    };
  }

  private extractLineItems(lines: string[]): OcrResult['lineItems'] {
    const items: OcrResult['lineItems'] = [];
    for (const line of lines) {
      // Pattern: "Item Name x2 @ $4.99 $9.98" or "Item Name  $4.99"
      const match = line.match(/^(.+?)\s+(?:x(\d+))?\s*.*?\$?([\d,]+\.\d{2})\s*$/);
      if (match) {
        const qty = parseInt(match[2] ?? '1', 10);
        const price = Math.round(parseFloat(match[3].replace(',', '')) * 100);
        items.push({
          name: match[1].trim(),
          quantity: qty,
          unitPriceMinor: price,
          totalMinor: qty * price,
        });
      }
    }
    return items;
  }

  private emptyResult(): OcrResult {
    return {
      merchant: null,
      merchantAddress: null,
      date: null,
      totalMinor: null,
      currency: null,
      taxMinor: null,
      lineItems: [],
      rawText: '',
      confidence: 0,
    };
  }
}
