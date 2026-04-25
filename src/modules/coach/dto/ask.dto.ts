import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Coach prompt input. Length-capped to keep memory bounded and to make
 * the future LLM call's token budget predictable.
 */
export class AskCoachDto {
  @ApiProperty({ example: 'How am I doing this month?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt!: string;
}
