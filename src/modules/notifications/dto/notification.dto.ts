import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  pushToken!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isTrusted?: boolean;
}

export class CreateNotificationDto {
  @ApiProperty({ enum: ['push', 'email', 'inapp', 'sms'] })
  @IsIn(['push', 'email', 'inapp', 'sms'])
  channel!: 'push' | 'email' | 'inapp' | 'sms';

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  type!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;
}
