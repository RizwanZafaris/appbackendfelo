import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { DataRetentionService } from './data-retention.service';
import { GdprExportService } from './gdpr-export.service';

@Module({
  controllers: [ComplianceController],
  providers: [DataRetentionService, GdprExportService],
  exports: [DataRetentionService, GdprExportService],
})
export class ComplianceModule {}
