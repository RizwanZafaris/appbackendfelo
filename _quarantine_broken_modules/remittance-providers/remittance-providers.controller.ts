import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RemittanceProvidersService } from './remittance-providers.service';

@ApiTags('remittance-providers')
@ApiBearerAuth()
@Controller('remittance')
export class RemittanceProvidersController {
  constructor(private readonly svc: RemittanceProvidersService) {}

  @Get('providers')
  @ApiOperation({ summary: 'Catalog of active remittance providers' })
  getCatalog() {
    return this.svc.getCatalog();
  }

  @Get('providers/:code')
  @ApiOperation({ summary: 'Get a single provider by code' })
  getByCode(@Param('code') code: string) {
    return this.svc.getByCode(code);
  }
}
