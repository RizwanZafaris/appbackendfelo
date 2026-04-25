import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ExchangeRequestDto {
  @ApiProperty({ description: 'Firebase ID token from the mobile client' })
  @IsString()
  @IsNotEmpty()
  firebaseIdToken!: string;

  @ApiProperty({ enum: ['canada', 'pakistan', 'other'], required: false })
  @IsOptional()
  @IsIn(['canada', 'pakistan', 'other'])
  corridor?: 'canada' | 'pakistan' | 'other';

  @ApiProperty({ required: false, example: 'en' })
  @IsOptional()
  @IsString()
  languageCode?: string;
}

export class ExchangeUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true }) displayName!: string | null;
  @ApiProperty({ enum: ['canada', 'pakistan', 'other'] }) corridor!: string;
  @ApiProperty() languageCode!: string;
  @ApiProperty({
    enum: ['not_started', 'in_progress', 'submitted', 'approved', 'rejected'],
  })
  kycStatus!: string;
}

export class ExchangeResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ type: ExchangeUserDto }) user!: ExchangeUserDto;
}
