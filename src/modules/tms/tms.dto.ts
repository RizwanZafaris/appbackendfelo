import { IsString, IsOptional, IsEnum, IsNotEmpty, MaxLength, IsNumber, IsBoolean, IsUUID, IsJSON } from 'class-validator';

export class CreateRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEnum(['velocity', 'threshold', 'pattern', 'geographic', 'new_user', 'sanctions'])
  type!: string;

  @IsJSON()
  config!: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;

  @IsNumber()
  @IsOptional()
  priority?: number = 0;
}

export class ResolveAlertDto {
  @IsEnum(['confirmed', 'false_positive', 'under_review'])
  status!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class CreateCaseDto {
  @IsEnum(['low', 'medium', 'high', 'critical'])
  priority!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @IsUUID('4', { each: true })
  alertIds!: string[];
}

export class UpdateCaseDto {
  @IsEnum(['open', 'in_progress', 'closed'])
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
