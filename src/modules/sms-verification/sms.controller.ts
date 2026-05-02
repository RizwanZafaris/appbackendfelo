import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators/public.decorator';

import { SendOtpDto, VerifyOtpDto } from './dto/sms.dto';
import { SmsService } from './sms.service';

@ApiTags('sms')
@Controller('sms')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  /**
   * OTP send endpoint. Public (pre-auth phone verification) so it must be
   * tightly rate-limited to block SMS-pumping fraud.
   *
   * Bucket caps (per IP, since the caller is not yet authenticated):
   *   - otp     : 5 per hour  (the canonical cap)
   *   - default : 60 per minute (defence-in-depth burst cap)
   */
  @Post('otp/send')
  @Public()
  @Throttle({ otp: { ttl: 60 * 60_000, limit: 5 } })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Send OTP via the IP/E164-routed SMS provider (D-005, D-006, D-007).',
  })
  async sendOtp(@Body() dto: SendOtpDto) {
    try {
      return await this.sms.sendOtp({
        phoneE164: dto.phoneE164,
        locale: dto.locale,
        ipDetectedCountry: dto.ipDetectedCountry,
      });
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * OTP verify. 10 attempts per 15 min per IP — accommodates legitimate
   * mistypes without enabling brute-force enumeration of 6-digit codes.
   */
  @Post('otp/verify')
  @Public()
  @Throttle({ default: { ttl: 15 * 60_000, limit: 10 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the 6-digit OTP and consume the challenge.' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.sms.verifyOtp({
      challengeId: dto.challengeId,
      code: dto.code,
    });
  }
}
