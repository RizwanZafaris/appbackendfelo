import { Module } from '@nestjs/common';

import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { ConfigRegistryService } from './config-registry.service';
import { VendorCredentialsService } from './vendor-credentials.service';

@Module({
  controllers: [AdminController],
  providers: [AdminAuthService, ConfigRegistryService, VendorCredentialsService],
  exports: [AdminAuthService, ConfigRegistryService, VendorCredentialsService],
})
export class AdminModule {}
