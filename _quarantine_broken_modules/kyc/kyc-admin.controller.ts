import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { KycService } from './kyc.service';

class ReviewKycDto {
  result!: 'clear' | 'consider' | 'unverified';
  note?: string;
  reviewedBy!: string;
}

@ApiTags('admin/kyc')
@ApiBearerAuth()
@Controller('admin/kyc/reviews')
export class KycAdminController {
  constructor(private readonly svc: KycService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({ summary: 'List KYC reviews (admin)' })
  list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listReviews({
      status,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Patch(':id')
  @ApiBody({ type: ReviewKycDto })
  @ApiOperation({ summary: 'Review a KYC check (admin)' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewKycDto,
  ) {
    return this.svc.review(id, dto);
  }
}
