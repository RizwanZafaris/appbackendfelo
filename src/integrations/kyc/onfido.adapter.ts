import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  KycApplicant,
  KycCheckResult,
  KycProvider,
  KycWebhookPayload,
} from './kyc-provider.port';

@Injectable()
export class OnfidoAdapter implements KycProvider {
  readonly name = 'onfido';
  private readonly log = new Logger(OnfidoAdapter.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.eu.onfido.com/v3.6';

  constructor(private readonly cfg: ConfigService) {
    this.apiKey = this.cfg.get<string>('ONFIDO_API_KEY');
  }

  async initiate(applicant: KycApplicant): Promise<KycCheckResult> {
    if (!this.apiKey) throw new Error('ONFIDO_API_KEY not configured');

    const body = {
      first_name: applicant.firstName,
      last_name: applicant.lastName,
      email: applicant.email,
      dob: applicant.dob,
      address: applicant.address,
    };

    const r = await fetch(`${this.baseUrl}/applicants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Token token=${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const detail = await r.text();
      this.log.error(`Onfido applicant creation failed: ${r.status} ${detail.slice(0, 200)}`);
      throw new Error(`Onfido API error ${r.status}`);
    }

    const data = (await r.json()) as { id: string };
    const applicantId = data.id;

    // Start a standard check
    const checkBody = {
      applicant_id: applicantId,
      report_names: ['document', 'facial_similarity_photo'],
      asynchronous: true,
    };

    const checkR = await fetch(`${this.baseUrl}/checks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Token token=${this.apiKey}`,
      },
      body: JSON.stringify(checkBody),
    });

    if (!checkR.ok) {
      const detail = await checkR.text();
      this.log.error(`Onfido check creation failed: ${checkR.status} ${detail.slice(0, 200)}`);
      throw new Error(`Onfido API error ${checkR.status}`);
    }

    const checkData = (await checkR.json()) as { id: string; status: string };

    return {
      providerCheckId: checkData.id,
      status: 'pending',
      vendorPayload: { applicantId, checkId: checkData.id, status: checkData.status },
    };
  }

  async status(providerCheckId: string): Promise<KycCheckResult> {
    if (!this.apiKey) throw new Error('ONFIDO_API_KEY not configured');

    const r = await fetch(`${this.baseUrl}/checks/${providerCheckId}`, {
      headers: { authorization: `Token token=${this.apiKey}` },
    });

    if (!r.ok) {
      this.log.error(`Onfido status fetch failed: ${r.status}`);
      throw new Error(`Onfido API error ${r.status}`);
    }

    const data = (await r.json()) as {
      id: string;
      status: string;
      result?: string;
      results_uri?: string;
    };

    const status =
      data.status === 'complete'
        ? ('complete' as const)
        : data.status === 'withdrawn'
          ? ('failed' as const)
          : ('in_progress' as const);

    const result =
      data.result === 'clear'
        ? ('clear' as const)
        : data.result === 'consider'
          ? ('consider' as const)
          : ('unverified' as const);

    return {
      providerCheckId: data.id,
      status,
      result,
      vendorPayload: data as unknown as Record<string, unknown>,
    };
  }

  parseWebhook(payload: Record<string, unknown>): KycWebhookPayload {
    const event = (payload.payload?.type as string) ?? (payload.action as string) ?? 'unknown';
    const providerCheckId =
      (payload.payload?.object?.id as string) ?? (payload.object_id as string) ?? '';
    return { event, providerCheckId, payload };
  }
}
