import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UploadReceiptDto {
  /** URL of the already-uploaded image (Supabase Storage signed URL). */
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  imageUrl!: string;

  /** Override OCR provider; defaults to system-configured one. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  provider?: string;
}

export class ConfirmReceiptDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  merchant?: string;

  @IsOptional()
  totalMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}
