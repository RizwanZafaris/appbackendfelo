import { IsOptional, IsString, IsInt, Length, Matches } from 'class-validator';

export class CreateOrderDto {
  @IsOptional()
  @IsInt()
  dealId?: number;

  @IsInt()
  methodId!: number;

  @IsString()
  @Matches(/^\d+$/)
  amountMinor!: string;

  @Length(3, 3)
  currency!: string;
}
