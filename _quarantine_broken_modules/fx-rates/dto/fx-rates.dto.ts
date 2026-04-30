import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class GetRateQueryDto {
  @ApiProperty({ example: 'CAD-PKR' })
  @IsString()
  @IsNotEmpty()
  pair!: string;
}

export class GetQuotesQueryDto {
  @ApiProperty({ example: 'CAD' })
  @IsString()
  @IsNotEmpty()
  source!: string;

  @ApiProperty({ example: 'PKR' })
  @IsString()
  @IsNotEmpty()
  target!: string;

  @ApiProperty({ example: 100000 })
  @IsNumber()
  @Min(1)
  amountMinor!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  userId?: string;
}
