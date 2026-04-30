import { IsString, IsInt, IsOptional, Length, Matches, Max, Min } from 'class-validator';

export class BookDealDto {
  @Length(3, 3)
  sourceCurrency!: string;

  @Length(3, 3)
  targetCurrency!: string;

  @IsString()
  @Matches(/^\d+$/)
  sourceAmountMinor!: string;

  @IsString()
  @Matches(/^\d+$/)
  targetAmountMinor!: string;

  @IsString()
  @Matches(/^\d+\.?\d*$/)
  ourRate!: string;

  @IsString()
  @Matches(/^\d+\.?\d*$/)
  marketRate!: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  marginBps!: number;
}
