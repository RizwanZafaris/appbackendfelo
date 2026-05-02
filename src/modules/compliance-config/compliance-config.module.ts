import { Module } from '@nestjs/common';
import { ComplianceConfigService } from './compliance-config.service';
import { ComplianceConfigController } from './compliance-config.controller';

@Module({
  providers: [ComplianceConfigService],
  controllers: [ComplianceConfigController],
  exports: [ComplianceConfigService],
})
export class ComplianceConfigModule {}
