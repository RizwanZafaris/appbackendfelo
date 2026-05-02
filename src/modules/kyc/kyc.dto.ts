import { IsString, IsOptional, IsEnum, IsUUID, IsNotEmpty, MaxLength, MinLength } from 'class-validator';

export class CreateKycProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  dob?: string;

  @IsString()
  @IsOptional()
  @MaxLength(3)
  nationality?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;
}

export class UploadDocumentDto {
  @IsEnum(['passport', 'id_card', 'proof_of_address', 'selfie', 'driving_license'])
  type!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsString()
  @IsOptional()
  fileKey?: string;
}

export class KycReviewDto {
  @IsEnum(['approved', 'rejected', 'needs_info'])
  status!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class KycQueueQueryDto {
  @IsEnum(['pending', 'in_review', 'approved', 'rejected', 'needs_info', 'all'])
  @IsOptional()
  status?: string;

  @IsUUID()
  @IsOptional()
  reviewerId?: string;

  @IsString()
  @IsOptional()
  search?: string;
}
