import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateMeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiProperty({ required: false, enum: ['en', 'ur'] })
  @IsOptional()
  @IsIn(['en', 'ur'])
  languageCode?: string;

  @ApiProperty({ required: false, enum: ['canada', 'pakistan', 'other'] })
  @IsOptional()
  @IsIn(['canada', 'pakistan', 'other'])
  corridor?: 'canada' | 'pakistan' | 'other';

  @ApiProperty({ required: false, example: 'CA' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiProperty({ required: false, example: 'CAD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ required: false, example: '+14165550199' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneE164?: string;

  @ApiProperty({ required: false, description: 'Monthly income in minor units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyIncomeMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  onboardingComplete?: boolean;
}
