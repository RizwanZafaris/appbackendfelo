import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UploadReceiptDto {
  @ApiProperty({ example: 'receipt_2025-01-15.jpg' })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mimeType!: string;
}

export class ConfirmReceiptDto {
  @ApiProperty({ example: 'Starbucks' })
  @IsString()
  @IsOptional()
  merchant?: string;

  @ApiProperty({ example: 2547 })
  @IsNumber()
  totalMinor!: number;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiPropertyOptional({ example: '2025-01-15' })
  @IsISO8601()
  @IsOptional()
  bookedAt?: string;

  @ApiPropertyOptional({ enum: ['debit', 'credit'] })
  @IsIn(['debit', 'credit'])
  @IsOptional()
  direction?: 'debit' | 'credit';

  @ApiPropertyOptional({ example: 331 })
  @IsNumber()
  @IsOptional()
  taxMinor?: number;

  @ApiPropertyOptional({ type: Array })
  @IsArray()
  @IsOptional()
  lineItems?: Array<{
    name: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
  }>;
}
