import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRecurringBillDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  merchant!: string;

  @ApiProperty({ description: 'Amount in minor units' })
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiProperty({ enum: ['weekly', 'monthly', 'quarterly', 'yearly'] })
  @IsIn(['weekly', 'monthly', 'quarterly', 'yearly'])
  frequency!: 'weekly' | 'monthly' | 'quarterly' | 'yearly';

  @ApiProperty({ required: false, description: 'ISO yyyy-mm-dd' })
  @IsOptional()
  @IsDateString()
  nextExpected?: string;
}

export class UpdateRecurringBillDto extends PartialType(CreateRecurringBillDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
