import { Module } from '@nestjs/common';
import { FeatureFlagsAdminController } from './feature-flags-admin.controller';
import { FeatureFlagsAdminService } from './feature-flags-admin.service';

@Module({
  controllers: [FeatureFlagsAdminController],
  providers: [FeatureFlagsAdminService],
  exports: [FeatureFlagsAdminService],
})
export class FeatureFlagsAdminModule {}
