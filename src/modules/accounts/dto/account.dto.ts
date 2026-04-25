import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ example: 'td' })
  @IsString()
  @MaxLength(40)
  provider!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ required: false, description: 'Balance in minor units (cents/paisa)' })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000_000_000)
  balanceMinor?: number;
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
