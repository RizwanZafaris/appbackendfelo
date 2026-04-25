import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiProperty({ required: false, enum: ['en', 'ur'] })
  @IsOptional()
  @IsIn(['en', 'ur'])
  languageCode?: string;

  @ApiProperty({ required: false, enum: ['canada', 'pakistan', 'other'] })
  @IsOptional()
  @IsIn(['canada', 'pakistan', 'other'])
  corridor?: 'canada' | 'pakistan' | 'other';
}
