import { Controller, Post, Body, Get } from '@nestjs/common';
import { SmsService, SmsSendRequest } from './sms.service';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  async sendSms(@Body() request: SmsSendRequest) {
    return this.smsService.sendSms(request);
  }

  @Post('send-otp')
  async sendOtp(@Body() body: { phoneNumber: string; otp: string; senderId?: string }) {
    const message = `This is an automated SMS from designzco.com your verification OTP is ${body.otp}. Please enter the PIN for instant verification Contact us on 03330235634 Thank you!`;
    return this.smsService.sendSms({
      phoneNumber: body.phoneNumber,
      message,
      type: 'otp',
      senderId: body.senderId,
    });
  }

  @Get('health')
  async checkHealth() {
    return this.smsService.checkRoutesHealth();
  }
}
