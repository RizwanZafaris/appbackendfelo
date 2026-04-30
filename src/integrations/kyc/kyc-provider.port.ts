/**
 * KYC Provider Port — vendor-agnostic interface for identity verification.
 *
 * Concrete adapters (OnfidoAdapter, MockKycAdapter) implement this port.
 * The KYC module depends only on this interface, never on vendor SDKs.
 */

export interface KycApplicant {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  dob?: string; // ISO-8601
  address?: {
    line1: string;
    city: string;
    country: string;
    postcode?: string;
  };
}

export interface KycCheckResult {
  providerCheckId: string;
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
  result?: 'clear' | 'consider' | 'unverified';
  vendorPayload: Record<string, unknown>;
}

export interface KycWebhookPayload {
  event: string;
  providerCheckId: string;
  payload: Record<string, unknown>;
}

export interface KycProvider {
  readonly name: string;

  /** Create an applicant and start a check. */
  initiate(applicant: KycApplicant): Promise<KycCheckResult>;

  /** Poll or refresh the status of an existing check. */
  status(providerCheckId: string): Promise<KycCheckResult>;

  /** Parse a vendor-specific webhook payload into a canonical result. */
  parseWebhook(payload: Record<string, unknown>): KycWebhookPayload;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
