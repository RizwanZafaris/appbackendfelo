/**
 * Strategy interface for SMS OTP delivery (D-005, D-006, D-007).
 *
 * Each adapter implements this interface and self-registers via the
 * SmsProviderRegistry based on env-driven activation. Drop in a vendor's
 * API key → adapter goes live, no other code change.
 */

export interface SmsSendParams {
  phoneE164: string;
  otpCode: string;
  /** Locale for templated SMS content (e.g., Urdu welcome message). */
  locale?: string;
  /** Per-corridor branded sender ID (e.g. "FELO"). */
  senderId?: string;
}

export interface SmsSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: { code: string; message: string };
}

export interface SmsProvider {
  /** ISO-3166 alpha-2 country codes this provider can deliver to. */
  readonly serves: readonly string[];

  /** Provider name for logs/analytics ('twilio', 'msg91', 'veevotech'). */
  readonly name: string;

  /** Whether the provider has its required credentials and is operational. */
  readonly active: boolean;

  send(params: SmsSendParams): Promise<SmsSendResult>;
}

/** DI token for the SmsProvider array. */
export const SMS_PROVIDERS = Symbol('SMS_PROVIDERS');
