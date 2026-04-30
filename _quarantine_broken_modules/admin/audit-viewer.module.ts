import { Module } from '@nestjs/common';
import { AuditViewerController } from './audit-viewer.controller';
import { AuditViewerService } from './audit-viewer.service';

@Module({
  controllers: [AuditViewerController],
  providers: [AuditViewerService],
  exports: [AuditViewerService],
})
export class AuditViewerModule {}
