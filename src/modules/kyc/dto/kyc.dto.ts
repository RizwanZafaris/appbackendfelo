import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * DTO for initiating a KYC verification flow.
 * The user must provide their email and phone number
 * so Sumsub can create an applicant record.
 */
export class InitiateKycDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 32)
  @IsOptional()
  phone?: string;
}

/**
 * DTO for the Sumsub webhook callback.
 * Sumsub sends a JSON payload with review results.
 * We keep the shape intentionally broad because Sumsub
 * sends many different event types.
 */
export class KycWebhookDto {
  @IsString()
  applicantId!: string;

  @IsString()
  @IsOptional()
  externalUserId?: string;

  @IsString()
  type!: string;

  @IsString()
  @IsOptional()
  reviewStatus?: string;

  reviewResult?: {
    reviewAnswer?: 'GREEN' | 'RED';
    moderationComment?: string | null;
    clientComment?: string | null;
    rejectLabels?: string[];
    reviewRejectType?: string | null;
  };

  @IsOptional()
  applicantType?: string;

  @IsOptional()
  inspectionId?: string;

  @IsOptional()
  correlationId?: string;

  @IsOptional()
  levelName?: string;

  /** Raw payload — kept for audit/debug. */
  @IsOptional()
  rawPayload?: Record<string, unknown>;
}

/**
 * Response returned when a KYC applicant is successfully created.
 */
export class KycApplicantResponse {
  applicantId!: string;
  status!: string;
  redirectUrl?: string;
}

/**
 * Response returned when querying the current KYC status.
 */
export class KycStatusResponse {
  applicantId!: string;
  status!: string;
  reviewResult?: string;
  moderationComment?: string | null;
  rejectLabels?: string[];
  updatedAt?: Date;
}
