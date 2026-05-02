import { IsIn, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class UploadStatementDto {
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  fileUrl!: string;

  @IsIn(['csv', 'ofx', 'qif', 'pdf', 'xlsx'])
  format!: 'csv' | 'ofx' | 'qif' | 'pdf' | 'xlsx';

  /** ISO-4217. Defaults to user's primary currency on commit. */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

export class CommitStatementDto {
  /** Optional: drop specific row hashes the user un-checked in preview. */
  @IsOptional()
  excludeHashes?: string[];
}
