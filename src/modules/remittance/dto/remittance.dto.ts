import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsUUID,
  MinLength,
  MaxLength,
  IsEnum,
  Matches,
  Length,
} from 'class-validator';

export class RemittanceQuoteDto {
  @IsString()
  @MinLength(2)
  corridor: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @Length(3, 3)
  sourceCurrency: string;

  @IsString()
  @Length(3, 3)
  targetCurrency: string;

  @IsString()
  payoutMethod: string;
}

export class InitiatePayoutDto {
  @IsUUID('4')
  routeId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @MinLength(2)
  recipientName: string;

  @IsString()
  @MinLength(5)
  recipientAccount: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  recipientBankCode?: string;

  @IsOptional()
  @IsString()
  recipientBankName?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}

export class WebhookPayloadDto {
  @IsString()
  providerCode: string;

  @IsOptional()
  payload: any;
}
