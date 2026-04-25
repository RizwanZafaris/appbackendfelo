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

export class CreateGoalDto {
  @ApiProperty({ example: 'Trip to Pakistan' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ description: 'Goal target in minor units' })
  @IsInt()
  @Min(0)
  targetMinor!: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  savedMinor?: number;

  @ApiProperty({ required: false, description: 'ISO date yyyy-mm-dd' })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiProperty({ enum: ['weekly', 'monthly', 'manual'] })
  @IsIn(['weekly', 'monthly', 'manual'])
  cadence!: 'weekly' | 'monthly' | 'manual';

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class UpdateGoalDto extends PartialType(CreateGoalDto) {}

export class ContributeGoalDto {
  @ApiProperty({ description: 'Contribution amount in minor units', example: 5000 })
  @IsInt()
  @Min(1)
  amountMinor!: number;
}
