import { IsString, IsOptional, IsEnum, IsNotEmpty, MaxLength, IsNumberString } from 'class-validator';

export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  businessName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  registrationNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  country!: string;

  @IsEnum(['llc', 'corporation', 'partnership', 'sole_proprietorship'])
  businessType!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  tradeLicense?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  incorporationDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  website?: string;
}

export class AddUboDto {
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

  @IsNumberString()
  ownershipPercentage!: string;

  @IsString()
  @IsOptional()
  kycProfileId?: string;
}

export class UploadBusinessDocDto {
  @IsEnum(['trade_license', 'articles_of_incorporation', 'bank_statement', 'financial_statement'])
  type!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsString()
  @IsOptional()
  fileKey?: string;
}

export class KybReviewDto {
  @IsEnum(['approved', 'rejected', 'needs_info'])
  status!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class KybQueueQueryDto {
  @IsEnum(['pending', 'in_review', 'approved', 'rejected', 'needs_info', 'all'])
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  search?: string;
}
