import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PatchFlagDto {
  @ApiProperty({ enum: ['assigned', 'approved', 'rejected', 'escalated'] })
  @IsIn(['assigned', 'approved', 'rejected', 'escalated'])
  status!: 'assigned' | 'approved' | 'rejected' | 'escalated';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assignedTo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  resolutionNote?: string;
}
