import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { KycService } from './kyc.service';

class InitiateKycDto {
  firstName!: string;
  lastName!: string;
  email?: string;
  dob?: string;
  address?: {
    line1: string;
    city: string;
    country: string;
    postcode?: string;
  };
}

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(private readonly svc: KycService) {}

  @Post('initiate')
  @ApiBody({ type: InitiateKycDto })
  @ApiOperation({ summary: 'Start a new KYC identity verification' })
  initiate(@CurrentUser() user: RequestUser, @Body() dto: InitiateKycDto) {
    return this.svc.initiate(user.id, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Check latest KYC status' })
  status(@CurrentUser() user: RequestUser) {
    return this.svc.status(user.id);
  }

  @Post('webhook/:provider')
  @ApiOperation({ summary: 'Vendor callback for KYC status updates (public)' })
  webhook(@Param('provider') provider: string, @Body() payload: Record<string, unknown>) {
    return this.svc.handleWebhook(provider, payload);
  }
}
