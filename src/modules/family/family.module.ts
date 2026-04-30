import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/modules/audit-log/audit-log.module';

import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';

@Module({
  imports: [AuditLogModule],
  controllers: [FamilyController],
  providers: [FamilyService],
  exports: [FamilyService],
})
export class FamilyModule {}
