import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { KycService } from '../kyc/kyc.service';
import { KycReviewDto, KycQueueQueryDto } from '../kyc/kyc.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

@Controller('admin/kyc')
@UseGuards(JwtAuthGuard)
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
  async reviewProfile(
    @Param('userId') userId: string,
    @Body() dto: KycReviewDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.kycService.reviewProfile(userId, { ...dto, reviewerId: user.id });
  }

  @Post(':userId/assign')
  async assignReviewer(@Param('userId') userId: string, @Body('reviewerId') reviewerId: string) {
    return this.kycService.assignReviewer(userId, reviewerId);
  }
}
