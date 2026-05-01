import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateThresholdDto {
  @IsString()
  @Length(1, 64)
  ruleKey!: string;

  @IsNumber()
  @Min(1)
  thresholdMinor!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  windowDays?: number;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  audience?: Record<string, unknown>;
}

export class UpdateThresholdDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  thresholdMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  windowDays?: number;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  audience?: Record<string, unknown>;

  @IsOptional()
  isActive?: boolean;
}

export class DecideFlagDto {
  @IsIn(['under_review', 'cleared', 'escalated', 'dismissed'])
  status!: 'under_review' | 'cleared' | 'escalated' | 'dismissed';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
