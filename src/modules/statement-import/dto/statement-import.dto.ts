import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadStatementDto {
  @ApiProperty({ enum: ['csv', 'ofx', 'pdf'] })
  @IsIn(['csv', 'ofx', 'pdf'])
  format!: 'csv' | 'ofx' | 'pdf';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  accountId?: string;
}

export class StatementRowDto {
  @ApiProperty({ example: '2025-01-15' })
  date!: string;

  @ApiProperty({ example: 'STARBUCKS #1234' })
  description!: string;

  @ApiProperty({ example: 2547 })
  amountMinor!: number;

  @ApiProperty({ example: 'CAD' })
  currency!: string;

  @ApiProperty({ enum: ['debit', 'credit'] })
  direction!: 'debit' | 'credit';
}

export class CommitStatementDto {
  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2025-01-31' })
  @IsISO8601()
  @IsOptional()
  endDate?: string;
}
