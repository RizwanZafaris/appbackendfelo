import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Canonical event payload — every sink (Postgres / GTM / Meta CAPI / future)
 * receives this shape and adapts to its own format. Per D-030.
 */
export class EventMetaDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  user_agent?: string;

  @ApiProperty({ required: false, example: 'en-CA' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;
}

export class CreateEventDto {
  @ApiProperty({ example: 'phase4_step1_completed' })
  @IsString()
  @MaxLength(120)
  event_name!: string;

  @ApiProperty({
    example: 'FR-4.1.3',
    description:
      'D-001 traceability: every event must carry the FRD ID it traces back to.',
  })
  @IsString()
  @MaxLength(40)
  frd_id!: string;

  @ApiProperty({ example: 'phase4_step1' })
  @IsString()
  @MaxLength(80)
  step_id!: string;

  @ApiProperty({ minimum: 0, maximum: 8 })
  @IsInt()
  @Min(0)
  @Max(8)
  phase!: number;

  @ApiProperty()
  @IsUUID()
  session_id!: string;

  @ApiProperty()
  @IsISO8601()
  occurred_at!: string;

  @ApiProperty({ description: 'Event-specific properties' })
  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  @ApiProperty({ type: () => EventMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EventMetaDto)
  meta?: EventMetaDto;
}

/**
 * Canonical event the dispatcher passes to each sink. Same shape as the
 * DTO but with user_id resolved from the JWT and ip_country redacted from
 * the raw IP at ingress.
 */
export interface CanonicalEvent {
  event_name: string;
  frd_id: string;
  step_id: string;
  phase: number;
  user_id: string | null;
  session_id: string;
  occurred_at: string;
  properties: Record<string, unknown>;
  meta: {
    user_agent?: string;
    locale?: string;
    ip_country?: string;
  };
}

export interface DispatchResult {
  ok: boolean;
  /**
   * Payload formatted for client-side GTM dataLayer.push. The
   * controller returns this in the response body so Flutter can push
   * to its bridge — server-side GTM proxying is not a v1 ask.
   */
  gtm_payload?: Record<string, unknown>;
  /** Per-sink outcome for ops visibility. */
  sinks: Record<string, { ok: boolean; reason?: string }>;
}
