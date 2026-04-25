import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+923001234567' })
  @IsString()
  @Matches(/^\+\d{6,20}$/, {
    message: 'phoneE164 must be E.164 format (+ followed by digits)',
  })
  phoneE164!: string;

  @ApiProperty({ required: false, example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiProperty({
    required: false,
    description:
      'IP-detected country (D-006 primary routing key). Resolved by Phase 2.',
    example: 'PK',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  ipDetectedCountry?: string;
}

export class VerifyOtpDto {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
