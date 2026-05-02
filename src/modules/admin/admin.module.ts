import { Module } from '@nestjs/common';

import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { ConfigRegistryService } from './config-registry.service';
import { VendorCredentialsService } from './vendor-credentials.service';
import { ApiKeyService } from './api-key.service';

@Module({
  controllers: [AdminController],
  providers: [AdminAuthService, ConfigRegistryService, VendorCredentialsService, ApiKeyService],
  exports: [AdminAuthService, ConfigRegistryService, VendorCredentialsService, ApiKeyService],
})
export class AdminModule {}
