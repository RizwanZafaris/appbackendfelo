/**
 * Hexagonal port for receipt OCR vendors. Implementations:
 *   • GoogleVisionAdapter (production default)
 *   • AwsTextractAdapter (fallback when Vision is unavailable)
 *   • MockOcrAdapter (CI / dev / e2e)
 *
 * Selection happens at runtime by reading `OCR_PROVIDER` from app_config
 * (or env var fallback). Vendor credentials are never read from source —
 * always from `vendor_credentials` (Squad 8).
 */
export interface OcrLineItem {
  name: string;
  amountMinor: number;
  quantity?: number;
}

export interface OcrResult {
  merchant: string | null;
  totalMinor: number | null;
  currency: string | null;
  lineItems: OcrLineItem[];
  confidence: number; // 0..1
  rawResponse: Record<string, unknown>;
}

export const OCR_PROVIDER = Symbol('OCR_PROVIDER');

export interface OcrProvider {
  readonly name: string;
  parse(imageUrl: string): Promise<OcrResult>;
}
