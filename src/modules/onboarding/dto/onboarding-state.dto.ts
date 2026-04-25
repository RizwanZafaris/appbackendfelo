import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Phase 4.2 account selection — one of these per bank/wallet picked.
 */
export class OnboardingAccountDto {
  @ApiProperty({ enum: ['bank', 'wallet'] })
  @IsIn(['bank', 'wallet'])
  account_kind!: 'bank' | 'wallet';

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  provider_slug!: string;

  @ApiProperty({ example: 'PK' })
  @IsString()
  @Length(2, 2)
  region_iso2!: string;
}

/**
 * Phase 5.1 budget category — one of these per category line.
 * Per D-020, semantic = 'inflow' for student "Family allowance received"
 * vs 'outflow' for everyone else's "Family support".
 */
export class OnboardingBudgetCategoryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  category_slug!: string;

  @ApiProperty({ description: 'Amount in minor units' })
  @IsInt()
  @Min(0)
  amount_minor!: number;

  @ApiProperty({ enum: ['inflow', 'outflow'] })
  @IsIn(['inflow', 'outflow'])
  semantic!: 'inflow' | 'outflow';
}

/**
 * Phase 5.2 goal — exactly 2 per user (D-008 hard limit).
 * Multi-currency per D-021.
 */
export class OnboardingGoalDto {
  @ApiProperty({ minimum: 1, maximum: 2 })
  @IsInt()
  @Min(1)
  slot!: 1 | 2;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  template_slug!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  custom_label?: string;

  @ApiProperty({ description: 'Target amount in minor units' })
  @IsInt()
  @Min(1)
  target_amount_minor!: number;

  @ApiProperty({ example: 'PKR' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ description: 'ISO yyyy-mm-dd', example: '2027-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  target_date!: string;
}

/**
 * Delta-merge state PATCH. Every field is optional — the controller
 * merges over existing state per FR-11.0.2. Per D-009 the client
 * persists locally first, then fires this fire-and-forget.
 */
export class PatchOnboardingStateDto {
  @ApiProperty({ required: false, example: 'PK' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  primary_region?: string;

  @ApiProperty({
    required: false,
    description: 'Up to 3 secondary regions per D-013',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  secondary_regions?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiProperty({ required: false, example: 'PK' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  ip_country?: string;

  // Phase 3
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  sms_granted?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  notifications_granted?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  location_granted?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  contacts_ack?: boolean;

  // Phase 4
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  earning_types?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  earning_type_custom?: string;

  @ApiProperty({ required: false, type: [OnboardingAccountDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingAccountDto)
  accounts?: OnboardingAccountDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  accounts_deferred?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  invests?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  investment_types?: string[];

  // Phase 5
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  budget_total_minor?: number;

  @ApiProperty({ required: false, example: 'PKR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  budget_currency?: string;

  @ApiProperty({ required: false, type: [OnboardingBudgetCategoryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingBudgetCategoryDto)
  budget_categories?: OnboardingBudgetCategoryDto[];

  @ApiProperty({ required: false, type: [OnboardingGoalDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingGoalDto)
  goals?: OnboardingGoalDto[];

  // Phase 6
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  remittance_options?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sends_to?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  receives_from?: string[];

  // Cross-cutting D-009
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  last_completed_step?: string;
}

export class StartOnboardingSessionDto {
  /** Anonymous device id used pre-auth so resume works across cold-kill. */
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  device_id!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  client_started_at?: string;
}
