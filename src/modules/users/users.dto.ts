import { IsOptional, IsString, IsNumber, IsIn, IsObject } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  phoneE164?: string;

  @IsOptional()
  @IsNumber()
  monthlyIncomeMinor?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsIn(['canada', 'pakistan', 'other'])
  corridor?: string;

  @IsOptional()
  @IsString()
  languageCode?: string;

  @IsOptional()
  @IsNumber()
  feloScore?: number;

  @IsOptional()
  @IsString()
  subscriptionTier?: string;

  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'submitted', 'approved', 'rejected'])
  kycStatus?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['canada', 'pakistan', 'other'])
  corridor?: string;

  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'submitted', 'approved', 'rejected'])
  kycStatus?: string;
}
