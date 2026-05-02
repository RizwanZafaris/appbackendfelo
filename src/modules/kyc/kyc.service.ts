import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { createHmac } from 'crypto';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { profiles, kycDocuments } from '@db/schema';

import { KycWebhookDto } from './dto/kyc.dto';

/** Sumsub API response shape for created applicant. */
interface SumsubApplicant {
  id: string;
  externalUserId: string;
  createdAt: string;
  email?: string;
  phone?: string;
  source?: string;
  review?: {
    reviewStatus?: string;
    reviewResult?: {
      reviewAnswer?: 'GREEN' | 'RED';
      moderationComment?: string | null;
      clientComment?: string | null;
      rejectLabels?: string[];
      reviewRejectType?: string | null;
    };
  };
}

/** Sumsub API response shape for applicant status. */
interface SumsubApplicantStatus {
  id: string;
  createdAt: string;
  review?: {
    reviewStatus?: string;
    reviewResult?: {
      reviewAnswer?: 'GREEN' | 'RED';
      moderationComment?: string | null;
      clientComment?: string | null;
      rejectLabels?: string[];
      reviewRejectType?: string | null;
    };
  };
}

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private readonly baseUrl: string;
  private readonly appToken: string;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly levelName: string;

  constructor(
    private readonly cfg: ConfigService,
    @Inject(DRIZZLE) private readonly db: Drizzle,
  ) {
    this.baseUrl =
      this.cfg.get<string>('SUMSUB_BASE_URL') ?? 'https://test-api.sumsub.com';
    this.appToken = this.cfg.get<string>('SUMSUB_APP_TOKEN') ?? '';
    this.secretKey = this.cfg.get<string>('SUMSUB_SECRET_KEY') ?? '';
    this.webhookSecret = this.cfg.get<string>('SUMSUB_WEBHOOK_SECRET') ?? '';
    this.levelName = this.cfg.get<string>('SUMSUB_LEVEL_NAME') ?? 'basic-kyc-level';

    if (!this.appToken || !this.secretKey) {
      this.logger.warn(
        'Sumsub credentials are not configured. KYC flows will fail.',
      );
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Sumsub API Helpers
  // ────────────────────────────────────────────────────────────────

  /**
   * Generates the HMAC-SHA256 signature required by Sumsub.
   * Signature = HMAC(secretKey, timestamp + method.toUpperCase() + endpoint + body)
   */
  private signRequest(
    method: string,
    endpoint: string,
    body: string,
    timestamp: number = Date.now(),
  ): { signature: string; timestamp: number } {
    const ts = Math.floor(timestamp / 1000);
    const payload = `${ts}${method.toUpperCase()}${endpoint}${body}`;
    const signature = createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
    return { signature, timestamp: ts };
  }

  private buildHeaders(
    method: string,
    endpoint: string,
    body: string,
    idempotencyKey?: string,
  ): Record<string, string> {
    const { signature, timestamp } = this.signRequest(method, endpoint, body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-App-Token': this.appToken,
      'X-App-Token-Signature': signature,
      'X-App-Token-Timestamp': String(timestamp),
    };
    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey;
    }
    return headers;
  }

  private async sumsubFetch<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const bodyString = body ? JSON.stringify(body) : '';
    const headers = this.buildHeaders(method, endpoint, bodyString, idempotencyKey);

    const res = await fetch(url, {
      method,
      headers,
      body: bodyString || undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(
        `Sumsub API error — ${method} ${endpoint} → ${res.status}: ${text}`,
      );
      if (res.status === 409) {
        throw new ConflictException(
          'Applicant already exists or request is conflicting',
        );
      }
      if (res.status === 404) {
        throw new NotFoundException('Applicant not found on Sumsub');
      }
      throw new InternalServerErrorException(
        `Sumsub API error (${res.status}): ${text}`,
      );
    }

    return (await res.json()) as T;
  }

  // ────────────────────────────────────────────────────────────────
  // Applicant Lifecycle
  // ────────────────────────────────────────────────────────────────

  /**
   * Creates a Sumsub applicant for the given user.
   * Stores the applicant ID locally so we can map webhooks back to the user.
   * Idempotent: if an applicant already exists we return the existing one.
   */
  async createApplicant(
    userId: string,
    email: string,
    phone?: string,
  ): Promise<{ applicantId: string; status: string }> {
    // Check if we already have an applicant for this user.
    const [existing] = await this.db
      .select({ kycStatus: profiles.kycStatus, sumsubApplicantId: profiles.sumsubApplicantId })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException('User profile not found');
    }

    if (existing.sumsubApplicantId) {
      this.logger.log(`Reusing existing applicant ${existing.sumsubApplicantId} for user ${userId}`);
      return {
        applicantId: existing.sumsubApplicantId,
        status: existing.kycStatus,
      };
    }

    const idempotencyKey = this.generateIdempotencyKey(userId, email);
    const endpoint = `/resources/applicants?levelName=${encodeURIComponent(this.levelName)}`;
    const body = {
      externalUserId: userId,
      email,
      phone: phone || undefined,
      source: 'FeloApp',
    };

    const applicant = await this.sumsubFetch<SumsubApplicant>(
      'POST',
      endpoint,
      body,
      idempotencyKey,
    );

    // Store applicant ID on the profile.
    await this.db
      .update(profiles)
      .set({
        kycStatus: 'in_progress',
        sumsubApplicantId: applicant.id,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, userId));

    this.logger.log(
      `Created Sumsub applicant ${applicant.id} for user ${userId}`,
    );

    return {
      applicantId: applicant.id,
      status: 'in_progress',
    };
  }

  /**
   * Queries Sumsub for the current applicant status.
   */
  async getApplicantStatus(
    applicantId: string,
  ): Promise<{
    applicantId: string;
    status: string;
    reviewResult?: string;
    moderationComment?: string | null;
    rejectLabels?: string[];
    updatedAt?: Date;
  }> {
    const data = await this.sumsubFetch<SumsubApplicantStatus>(
      'GET',
      `/resources/applicants/${encodeURIComponent(applicantId)}/status`,
    );

    const review = data.review;
    const reviewAnswer = review?.reviewResult?.reviewAnswer;
    const mappedStatus = this.mapReviewAnswerToStatus(reviewAnswer, review?.reviewStatus);

    return {
      applicantId: data.id,
      status: mappedStatus,
      reviewResult: reviewAnswer,
      moderationComment: review?.reviewResult?.moderationComment ?? null,
      rejectLabels: review?.reviewResult?.rejectLabels ?? [],
      updatedAt: data.createdAt ? new Date(data.createdAt) : undefined,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Webhook Handling
  // ────────────────────────────────────────────────────────────────

  /**
   * Verifies the Sumsub webhook signature.
   * Sumsub sends the digest in the `X-Payload-Digest` header
   * and the algorithm in `X-Payload-Digest-Alg`.
   */
  verifyWebhookSignature(
    rawBody: string,
    digestHeader: string,
    algorithmHeader: string,
  ): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('SUMSUB_WEBHOOK_SECRET not set; skipping signature verification');
      return true; // Fail-open in dev when secret is missing
    }

    if (algorithmHeader !== 'HMAC_SHA256_HEX') {
      this.logger.warn(`Unsupported webhook digest algorithm: ${algorithmHeader}`);
      return false;
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const ok = expected === digestHeader;
    if (!ok) {
      this.logger.warn('Webhook signature mismatch');
    }
    return ok;
  }

  /**
   * Processes an incoming Sumsub webhook.
   * Updates the user's KYC status and stores any document metadata.
   */
  async handleWebhook(payload: KycWebhookDto): Promise<{ processed: boolean }> {
    const {
      applicantId,
      externalUserId,
      reviewStatus,
      reviewResult,
      type,
    } = payload;

    if (!applicantId) {
      throw new BadRequestException('Webhook payload missing applicantId');
    }

    this.logger.log(
      `KYC webhook — type=${type} applicant=${applicantId} user=${externalUserId} status=${reviewStatus}`,
    );

    // Resolve the user. Prefer externalUserId from payload; fall back to DB lookup.
    let userId = externalUserId;
    if (!userId) {
      const [profile] = await this.db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.sumsubApplicantId, applicantId))
        .limit(1);
      if (!profile) {
        this.logger.error(`No profile found for applicant ${applicantId}`);
        throw new NotFoundException(`Unknown applicant ${applicantId}`);
      }
      userId = profile.id;
    }

    // Map Sumsub review answer to our internal status.
    const answer = reviewResult?.reviewAnswer;
    const mappedStatus = this.mapReviewAnswerToStatus(answer, reviewStatus);

    // Update profile KYC status.
    await this.db
      .update(profiles)
      .set({
        kycStatus: mappedStatus as
          | 'not_started'
          | 'in_progress'
          | 'submitted'
          | 'approved'
          | 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, userId));

    // Store document / review metadata in kycDocuments for audit.
    await this.db.insert(kycDocuments).values({
      userId,
      docType: 'other',
      fileUrl: `sumsub://applicant/${applicantId}`,
      status: this.mapToDocumentStatus(mappedStatus),
      vendorResponse: {
        provider: 'sumsub',
        applicantId,
        webhookType: type,
        reviewStatus,
        reviewResult: reviewResult ?? {},
        receivedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`Updated KYC status for user ${userId} → ${mappedStatus}`);

    return { processed: true };
  }

  // ────────────────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────────────────

  /** Maps Sumsub review answer + status to our internal KYC status enum. */
  private mapReviewAnswerToStatus(
    reviewAnswer?: 'GREEN' | 'RED',
    reviewStatus?: string,
  ): string {
    if (reviewAnswer === 'GREEN') return 'approved';
    if (reviewAnswer === 'RED') return 'rejected';
    if (reviewStatus === 'pending' || reviewStatus === 'init') return 'in_progress';
    if (reviewStatus === 'completed') return 'submitted';
    return 'in_progress';
  }

  /** Maps our KYC status to kycDocuments.status enum. */
  private mapToDocumentStatus(
    status: string,
  ): 'pending' | 'under_review' | 'approved' | 'rejected' {
    switch (status) {
      case 'approved':
        return 'approved';
      case 'rejected':
        return 'rejected';
      case 'submitted':
        return 'under_review';
      default:
        return 'pending';
    }
  }

  /** Generates a deterministic idempotency key from user data. */
  private generateIdempotencyKey(userId: string, email: string): string {
    const raw = `${userId}:${email}:${this.levelName}`;
    return createHmac('sha256', this.secretKey || 'fallback')
      .update(raw)
      .digest('hex');
  }
}
