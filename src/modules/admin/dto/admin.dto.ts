import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsEnum,
  IsUUID,
} from 'class-validator';

export class AdminRegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(2, { message: 'Display name must be at least 2 characters' })
  displayName: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class AdminLoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'TOTP token must be 6 characters' })
  @MaxLength(6, { message: 'TOTP token must be 6 characters' })
  totpToken?: string;
}

export class AdminRefreshDto {
  @IsString()
  refreshToken: string;
}

export class MFASetupDto {
  @IsUUID('4')
  adminId: string;
}

export class MFAVerifyDto {
  @IsUUID('4')
  adminId: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  token: string;
}

export class MFADisableDto {
  @IsUUID('4')
  adminId: string;

  @IsString()
  @MinLength(8)
  password: string;
}
