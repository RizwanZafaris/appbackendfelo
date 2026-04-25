import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators/public.decorator';

import { SendOtpDto, VerifyOtpDto } from './dto/sms.dto';
import { SmsService } from './sms.service';

@ApiTags('sms')
@Controller('sms')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @Post('otp/send')
  @Public()
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

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the 6-digit OTP and consume the challenge.' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.sms.verifyOtp({
      challengeId: dto.challengeId,
      code: dto.code,
    });
  }
}
