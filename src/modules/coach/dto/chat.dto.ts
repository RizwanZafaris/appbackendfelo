import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { AVAILABLE_MODELS } from '../llm/providers/registry';

const MODELS = AVAILABLE_MODELS.map((m) => m.model);
const PROVIDERS = [...new Set(AVAILABLE_MODELS.map((m) => m.provider))];

/**
 * Input for the LLM-backed Coach chat endpoint. `conversationId` is
 * optional — if absent, a fresh conversation is created and its id
 * returned in the response. The pair (provider, model) is checked
 * against AVAILABLE_MODELS in the controller (DTO can't enforce pair
 * relationships).
 */
export class ChatCoachDto {
  @ApiProperty({ example: 'How am I doing this month?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @ApiProperty({
    required: false,
    description: 'Existing conversation id; new one created if omitted',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ enum: PROVIDERS, default: 'anthropic' })
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string = 'anthropic';

  @ApiProperty({ enum: MODELS, default: 'claude-sonnet-4-6' })
  @IsOptional()
  @IsIn(MODELS)
  model?: string = 'claude-sonnet-4-6';
}
