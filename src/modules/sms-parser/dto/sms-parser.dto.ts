import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsISO8601, IsNotEmpty, IsString } from 'class-validator';

export class SmsMessageDto {
  @ApiProperty({ example: 'TD-CANADA' })
  @IsString()
  @IsNotEmpty()
  sender!: string;

  @ApiProperty({ example: 'Purchase of $25.47 at STARBUCKS #1234. Balance: $1,234.56' })
  @IsString()
  @IsNotEmpty()
  body!: string;

  @ApiProperty({ example: '2025-01-15T14:30:00Z' })
  @IsISO8601()
  receivedAt!: string;
}

export class IngestSmsDto {
  @ApiProperty({ type: [SmsMessageDto] })
  @IsArray()
  messages!: SmsMessageDto[];
}
