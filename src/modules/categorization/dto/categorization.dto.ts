import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class SuggestCategoryDto {
  @ApiPropertyOptional({ example: 'Starbucks' })
  @IsString()
  @IsOptional()
  merchant?: string;

  @ApiPropertyOptional({ example: 'Coffee purchase at Starbucks' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'food_dining' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ example: 'Food & Dining' })
  @IsString()
  @IsNotEmpty()
  labelEn!: string;

  @ApiPropertyOptional({ example: 'خوراک و ریستوران' })
  @IsString()
  @IsOptional()
  labelUr?: string;

  @ApiPropertyOptional({ example: 'food_dining' })
  @IsString()
  @IsOptional()
  parentKey?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: ['restaurant', 'cafe', 'food'] })
  @IsArray()
  @IsOptional()
  keywords?: string[];
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Food & Dining' })
  @IsString()
  @IsOptional()
  labelEn?: string;

  @ApiPropertyOptional({ example: 'خوراک و ریستوران' })
  @IsString()
  @IsOptional()
  labelUr?: string;

  @ApiPropertyOptional({ example: 'food_dining' })
  @IsString()
  @IsOptional()
  parentKey?: string | null;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: ['restaurant', 'cafe', 'food'] })
  @IsArray()
  @IsOptional()
  keywords?: string[];

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
