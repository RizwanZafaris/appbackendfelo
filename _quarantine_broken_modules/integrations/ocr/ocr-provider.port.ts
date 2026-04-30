/**
 * OCR Provider Port — adapter pattern for receipt parsing.
 *
 * Per the mechanism rule: vendor adapters sit behind a stable port.
 * Swapping Google Vision for Azure Document Intelligence is a matter
 * of writing a new adapter and changing the DI token binding.
 */

/** Parsed line item from a receipt. */
export interface ParsedLineItem {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

/** Normalized OCR result — vendor-agnostic. */
export interface OcrResult {
  merchant: string | null;
  merchantAddress: string | null;
  date: string | null; // ISO date or null
  totalMinor: number | null;
  currency: string | null; // ISO-4217 or null
  taxMinor: number | null;
  lineItems: ParsedLineItem[];
  rawText: string;
  confidence: number; // 0..1
}

/** Port interface — every OCR adapter implements this. */
export interface OcrProvider {
  /** Provider name for logs/cost attribution. */
  readonly name: string;

  /**
   * Parse an image. The adapter downloads the image from the given
   * URL/path and returns a normalized OcrResult.
   */
  parse(imageUrl: string): Promise<OcrResult>;
}

/** DI token for the active OCR provider. */
export const OCR_PROVIDER = Symbol('OCR_PROVIDER');
