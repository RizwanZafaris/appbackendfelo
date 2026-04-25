import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  pushToken!: string;

  // NOTE: `isTrusted` is intentionally NOT in the wire DTO. Trust must be
  // server-set (e.g., after a successful MFA verification on this device),
  // never client-asserted.
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

  /**
   * Typed metadata payload for the Flutter union-type rendering. Stored
   * verbatim in the `notifications.payload` JSONB column. Examples:
   *   { kind: 'budget_alert', budgetId: '…', thresholdPercent: 80 }
   *   { kind: 'goal_milestone', goalId: '…', progressPercent: 50 }
   *   { kind: 'sms_parser_event', parsedSmsId: '…', confidencePercent: 88 }
   *   { kind: 'family_activity', memberId: '…' }
   *
   * Backend never validates the shape — it's a typed contract between
   * the notification emitter (worker / event handlers) and the Flutter
   * client. Default empty object so existing callers don't have to opt in.
   */
  @ApiProperty({
    required: false,
    description: 'Typed metadata for the Flutter client (kind + ids).',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
