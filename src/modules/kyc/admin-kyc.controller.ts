import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { KycService } from '../kyc/kyc.service';
import { KycReviewDto, KycQueueQueryDto } from '../kyc/kyc.dto';

@Controller('admin/kyc')
export class AdminKycController {
  constructor(private readonly kycService: KycService) {}

  @Get('queue')
  async getQueue(@Query() query: KycQueueQueryDto) {
    return this.kycService.getReviewQueue(
      (query.status as any) || 'all',
      query.reviewerId,
      query.search,
    );
  }

  @Get(':userId')
  async getProfile(@Param('userId') userId: string) {
    return this.kycService.getProfileForAdmin(userId);
  }

  @Patch(':userId/status')
  async reviewProfile(@Param('userId') userId: string, @Body() dto: KycReviewDto) {
    const reviewerId = 'system'; // TODO: get from auth context
    return this.kycService.reviewProfile(userId, { ...dto, reviewerId });
  }

  @Post(':userId/assign')
  async assignReviewer(@Param('userId') userId: string, @Body('reviewerId') reviewerId: string) {
    return this.kycService.assignReviewer(userId, reviewerId);
  }
}
