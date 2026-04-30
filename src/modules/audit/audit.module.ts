import { Module } from '@nestjs/common';

import { DatabaseService } from '@/common/database.service';

import { AuditService } from './audit.service';

@Module({
  providers: [DatabaseService, AuditService],
  exports: [AuditService, DatabaseService],
})
export class AuditModule {}
