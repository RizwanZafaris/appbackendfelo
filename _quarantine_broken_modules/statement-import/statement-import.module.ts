import { Module } from '@nestjs/common';

import { CsvParser } from './parsers/csv.parser';
import { OfxParser } from './parsers/ofx.parser';
import { PdfParser } from './parsers/pdf.parser';
import { StatementImportController } from './statement-import.controller';
import { StatementImportService } from './statement-import.service';

@Module({
  controllers: [StatementImportController],
  providers: [StatementImportService, CsvParser, OfxParser, PdfParser],
  exports: [StatementImportService],
})
export class StatementImportModule {}
