import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTransactionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ description: 'Amount in minor units' })
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @ApiProperty({ enum: ['debit', 'credit'] })
  @IsIn(['debit', 'credit'])
  direction!: 'debit' | 'credit';

  @ApiProperty({ enum: ['sms', 'manual', 'bank_alert', 'ocr', 'import'] })
  @IsIn(['sms', 'manual', 'bank_alert', 'ocr', 'import'])
  source!: 'sms' | 'manual' | 'bank_alert' | 'ocr' | 'import';

  @ApiProperty({ required: false, example: '0.92' })
  @IsOptional()
  @IsNumberString()
  parserConfidence?: string;

  @ApiProperty({ description: 'ISO timestamp when the transaction posted' })
  @IsDateString()
  bookedAt!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  receiptUrl?: string;
}

export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {}
