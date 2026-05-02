import { Module } from '@nestjs/common';

import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { ConfigRegistryService } from './config-registry.service';
import { LaunchReadinessModule } from './launch-readiness/launch-readiness.module';
import { VendorCredentialsService } from './vendor-credentials.service';

@Module({
  imports: [LaunchReadinessModule],
  controllers: [AdminController],
  providers: [AdminAuthService, ConfigRegistryService, VendorCredentialsService],
  exports: [
    AdminAuthService,
    ConfigRegistryService,
    VendorCredentialsService,
    LaunchReadinessModule,
  ],
})
export class AdminModule {}
