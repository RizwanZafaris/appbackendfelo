import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class WebhookSignatureService {
  private readonly logger = new Logger(WebhookSignatureService.name);

  /**
   * Verify webhook signature using HMAC-SHA256.
   * Supports multiple provider formats:
   * - Stripe: t=timestamp,v1=signature
   * - Generic: sha256=hex_signature
   */
  verifySignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
    provider: string = 'generic',
    toleranceSeconds: number = 300,
  ): boolean {
    try {
      switch (provider.toLowerCase()) {
        case 'stripe':
          return this.verifyStripeSignature(payload, signature, secret, toleranceSeconds);
        case 'generic':
        default:
          return this.verifyGenericSignature(payload, signature, secret);
      }
    } catch (error) {
      this.logger.warn(`Webhook signature verification failed: ${error.message}`);
      return false;
    }
  }

  private verifyStripeSignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
    toleranceSeconds: number,
  ): boolean {
    const elements = signature.split(',');
    const signatures = new Map<string, string>();

    for (const element of elements) {
      const [key, value] = element.split('=');
      signatures.set(key.trim(), value.trim());
    }

    const timestamp = parseInt(signatures.get('t') || '0', 10);
    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - timestamp) > toleranceSeconds) {
      this.logger.warn('Webhook timestamp outside tolerance window');
      return false;
    }

    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    const v1Signature = signatures.get('v1');
    if (!v1Signature) return false;

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(v1Signature, 'hex'),
    );
  }

  private verifyGenericSignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
  ): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Handle "sha256=" prefix if present
    const actualSig = signature.replace(/^sha256=/, '');

    if (expectedSignature.length !== actualSig.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(actualSig, 'hex'),
    );
  }

  /**
   * Generate a webhook signature for testing/internal use.
   */
  generateSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }
}
