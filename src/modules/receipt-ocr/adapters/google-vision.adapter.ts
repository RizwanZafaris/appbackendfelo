import { Injectable, Logger } from '@nestjs/common';

import { OcrLineItem, OcrProvider, OcrResult } from './ocr-provider.port';

/**
 * Google Cloud Vision text-detection adapter.
 *
 * Calls https://vision.googleapis.com/v1/images:annotate with a
 * service-account access token. The full response is captured in
 * receiptUploads.ocrResponse for audit / debugging.
 *
 * Production must inject GCP_SA_ACCESS_TOKEN via the ConfigRegistry +
 * VendorCredentials services (Squad 8). For dev, set
 * GCP_SA_ACCESS_TOKEN env var.
 */
@Injectable()
export class GoogleVisionAdapter implements OcrProvider {
  readonly name = 'google-vision';
  private readonly logger = new Logger(GoogleVisionAdapter.name);

  async parse(imageUrl: string): Promise<OcrResult> {
    const token = process.env.GCP_SA_ACCESS_TOKEN;
    if (!token) {
      throw new Error('GCP_SA_ACCESS_TOKEN not configured for google-vision');
    }

    // For images stored in Supabase Storage we pass the public URL via
    // imageSource.imageUri; for opaque buffers callers should pre-upload.
    const body = {
      requests: [
        {
          image: { source: { imageUri: imageUrl } },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        },
      ],
    };

    const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.warn(`Vision API error ${res.status}: ${errText.slice(0, 200)}`);
      throw new Error(`Vision API ${res.status}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    return parseVisionResponse(json);
  }
}

export function parseVisionResponse(json: Record<string, unknown>): OcrResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responses = (json as any).responses ?? [];
  const first = responses[0] ?? {};
  const fullText: string = first?.fullTextAnnotation?.text ?? '';
  const lines = fullText.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);

  const merchant = lines[0] ?? null;
  const total = extractTotal(fullText);
  const currency = extractCurrency(fullText);
  const lineItems = extractLineItems(lines);

  // Confidence proxy from average symbol confidence on the first page.
  let confidence = 0.5;
  const pageConfs: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const page of (first?.fullTextAnnotation?.pages ?? []) as any[]) {
    if (typeof page.confidence === 'number') pageConfs.push(page.confidence);
  }
  if (pageConfs.length > 0) {
    confidence = pageConfs.reduce((a, b) => a + b, 0) / pageConfs.length;
  }

  return {
    merchant,
    totalMinor: total,
    currency,
    lineItems,
    confidence: Math.max(0, Math.min(1, confidence)),
    rawResponse: json,
  };
}

const TOTAL_REGEX = /\b(?:total|grand\s*total|amount\s*due|balance|net\s*total)\b[^\d]*([\d,]+(?:\.\d{1,2})?)/i;
function extractTotal(text: string): number | null {
  const m = TOTAL_REGEX.exec(text);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100);
}

const CURRENCY_REGEX = /\b(USD|CAD|GBP|EUR|PKR|INR|AED|SAR|AUD|JPY)\b|(\$|€|£|¥|₨|₹|﷼)/;
function extractCurrency(text: string): string | null {
  const m = CURRENCY_REGEX.exec(text);
  if (!m) return null;
  if (m[1]) return m[1];
  switch (m[2]) {
    case '$':
      return 'USD';
    case '€':
      return 'EUR';
    case '£':
      return 'GBP';
    case '¥':
      return 'JPY';
    case '₨':
    case '﷼':
      return 'PKR';
    case '₹':
      return 'INR';
    default:
      return null;
  }
}

// Lines that contain a price and aren't summary rows become line items.
const SUMMARY_KEYWORDS = /^(sub\s*total|total|tax|gst|hst|vat|tip|cash|change|paid|balance)/i;
const PRICE_REGEX = /([\d,]+(?:\.\d{1,2})?)\s*$/;
function extractLineItems(lines: string[]): OcrLineItem[] {
  const items: OcrLineItem[] = [];
  for (const line of lines) {
    if (SUMMARY_KEYWORDS.test(line)) continue;
    const m = PRICE_REGEX.exec(line);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isNaN(amount) || amount <= 0) continue;
    const name = line.replace(PRICE_REGEX, '').trim();
    if (!name) continue;
    items.push({ name, amountMinor: Math.round(amount * 100) });
  }
  return items.slice(0, 50); // cap to keep payload bounded
}
