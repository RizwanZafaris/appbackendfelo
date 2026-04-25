import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ParticipantInputDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ description: 'Per-participant share in minor units' })
  @IsInt()
  @Min(0)
  shareMinor!: number;

  @ApiProperty({ required: false, description: 'Felo user id (optional)' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class CreateSplitDto {
  @ApiProperty({ example: 'Dinner Saturday' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ description: 'Total amount in minor units' })
  @IsInt()
  @Min(0)
  totalMinor!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;

  @ApiProperty({ type: [ParticipantInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => ParticipantInputDto)
  participants?: ParticipantInputDto[];
}

export class UpdateSplitDto extends PartialType(CreateSplitDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isSettled?: boolean;
}

export class MarkPaidDto {
  @ApiProperty()
  @IsBoolean()
  paid!: boolean;
}
