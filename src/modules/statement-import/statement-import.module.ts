import { Module } from '@nestjs/common';

import { CsvStatementParser } from './parsers/csv.parser';
import { OfxStatementParser } from './parsers/ofx.parser';
import { StatementImportController } from './statement-import.controller';
import { StatementImportService } from './statement-import.service';

@Module({
  controllers: [StatementImportController],
  providers: [CsvStatementParser, OfxStatementParser, StatementImportService],
  exports: [StatementImportService],
})
export class StatementImportModule {}
