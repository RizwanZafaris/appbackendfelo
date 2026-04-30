import { Module } from '@nestjs/common';

import { RemittanceProvidersController } from './remittance-providers.controller';
import { RemittanceProvidersService } from './remittance-providers.service';

@Module({
  controllers: [RemittanceProvidersController],
  providers: [RemittanceProvidersService],
  exports: [RemittanceProvidersService],
})
export class RemittanceProvidersModule {}
