import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { ReferralsService } from './referrals.service';

class RedeemDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

@ApiTags('referrals')
@ApiBearerAuth()
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  @Get('my-code')
  @ApiOperation({ summary: "Get (or create on demand) the current user's referral code" })
  myCode(@CurrentUser() user: RequestUser) {
    return this.svc.getOrCreateMyCode(user.id);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List referrals I sent' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.listMyReferrals(user.id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Counts + total rewards earned' })
  stats(@CurrentUser() user: RequestUser) {
    return this.svc.stats(user.id);
  }

  @Post('redeem')
  @ApiBody({ type: RedeemDto })
  @ApiOperation({ summary: 'Redeem a referral code as the new user' })
  redeem(@CurrentUser() user: RequestUser, @Body() body: RedeemDto) {
    return this.svc.redeem(user.id, body.code);
  }

  @Post(':id/qualify')
  @ApiOperation({ summary: 'Mark a referral as qualified (milestone reached)' })
  qualify(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.qualify(id, user.id);
  }
}
