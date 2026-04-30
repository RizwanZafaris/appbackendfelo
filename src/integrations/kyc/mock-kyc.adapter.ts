import { Injectable } from '@nestjs/common';

import {
  KycApplicant,
  KycCheckResult,
  KycProvider,
  KycWebhookPayload,
} from './kyc-provider.port';

/**
 * Mock KYC adapter for development and testing.
 * Simulates async check completion with configurable delays.
 */
@Injectable()
export class MockKycAdapter implements KycProvider {
  readonly name = 'mock';

  async initiate(applicant: KycApplicant): Promise<KycCheckResult> {
    const providerCheckId = `mock_${Math.random().toString(36).slice(2, 10)}`;
    return {
      providerCheckId,
      status: 'pending',
      vendorPayload: {
        applicantId: applicant.userId,
        mock: true,
        simulated: true,
      },
    };
  }

  async status(providerCheckId: string): Promise<KycCheckResult> {
    // Simulate progressive status
    const hash = providerCheckId.split('_')[1] ?? '';
    const state = hash.charCodeAt(0) % 3;
    const statuses: Array<'pending' | 'in_progress' | 'complete'> = [
      'pending',
      'in_progress',
      'complete',
    ];
    const results: Array<'clear' | 'consider' | 'unverified'> = ['clear', 'consider', 'clear'];

    return {
      providerCheckId,
      status: statuses[state] ?? 'complete',
      result: results[state] ?? 'clear',
      vendorPayload: { mock: true, state },
    };
  }

  parseWebhook(payload: Record<string, unknown>): KycWebhookPayload {
    return {
      event: (payload.event as string) ?? 'mock.complete',
      providerCheckId: (payload.providerCheckId as string) ?? '',
      payload,
    };
  }
}
