import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

const ASSET_CLASSES = [
  'equity',
  'etf',
  'crypto',
  'mutual_fund',
  'bond',
  'real_estate',
  'other',
] as const;

export class CreateInvestmentDto {
  @ApiProperty({ example: 'AAPL' })
  @IsString()
  @MaxLength(40)
  symbol!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ enum: ASSET_CLASSES })
  @IsIn(ASSET_CLASSES as unknown as string[])
  assetClass!: (typeof ASSET_CLASSES)[number];

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ description: 'Units held (decimal)', example: '12.5' })
  @IsNumberString()
  units!: string;

  @ApiProperty({ description: 'Total cost basis in minor units', example: 250000 })
  @IsInt()
  @Min(0)
  costBasisMinor!: number;

  @ApiProperty({ required: false, description: 'Current price per unit in minor units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  lastPriceMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}

export class UpdateInvestmentDto extends PartialType(CreateInvestmentDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class UpdatePriceDto {
  @ApiProperty({ description: 'New price per unit in minor units' })
  @IsInt()
  @Min(0)
  lastPriceMinor!: number;
}
