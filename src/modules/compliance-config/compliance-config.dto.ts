import { IsString, IsOptional, IsEnum, IsNotEmpty, MaxLength } from 'class-validator';

export class UpdateComplianceConfigDto {
  @IsEnum(['kyc', 'kyb', 'tms'])
  section!: string;

  @IsString()
  @IsNotEmpty()
  config!: string;
}
