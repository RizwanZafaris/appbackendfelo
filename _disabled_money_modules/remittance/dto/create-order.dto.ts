import { IsInt, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateOrderDto {
  @IsOptional()
  @IsInt()
  dealId?: number;

  @IsInt()
  methodId!: number;

  /** Bigint as string — preserves precision above 2^53. */
  @IsString()
  @Matches(/^\d+$/)
  amountMinor!: string;

  @Length(3, 3)
  currency!: string;

  /**
   * Idempotency key — caller supplies a stable random value per logical
   * request. Replays return the original orderId. Also accepted via the
   * Idempotency-Key header.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;

  /**
   * Pre-hashed recipient identifier (e.g. SHA-256 of recipient
   * account/phone). Used for sanctions/PEP screening. Hashing keeps the
   * raw account number out of the application body when re-screening on
   * later events.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  recipientHash!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  recipientCountry?: string;
}
