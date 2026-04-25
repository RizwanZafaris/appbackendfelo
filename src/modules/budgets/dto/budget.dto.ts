import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBudgetDto {
  @ApiProperty({ example: 'Groceries' })
  @IsString()
  @MaxLength(80)
  category!: string;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ description: 'Budget cap in minor units', example: 90000 })
  @IsInt()
  @Min(0)
  limitMinor!: number;

  @ApiProperty({ enum: ['weekly', 'monthly', 'custom'] })
  @IsIn(['weekly', 'monthly', 'custom'])
  period!: 'weekly' | 'monthly' | 'custom';

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  rolloverEnabled?: boolean;

  @ApiProperty({ required: false, default: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  alertThresholdPercent?: number;

  @ApiProperty({ description: 'Inclusive start date (ISO yyyy-mm-dd)' })
  @IsDateString()
  startsOn!: string;
}

export class UpdateBudgetDto extends PartialType(CreateBudgetDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
