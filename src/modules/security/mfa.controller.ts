import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { MfaService } from './mfa.service';

class VerifyMfaDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 32) // 6 for TOTP, longer for recovery code
  code!: string;
}

@ApiTags('security')
@ApiBearerAuth()
@Controller('security/mfa')
export class MfaController {
  constructor(private readonly svc: MfaService) {}

  @Get('status')
  @ApiOperation({ summary: 'Check 2FA enrollment + remaining recovery codes' })
  status(@CurrentUser() user: RequestUser) {
    return this.svc.status(user.id);
  }

  @Post('enroll')
  @ApiOperation({ summary: 'Generate TOTP secret + QR for authenticator app' })
  enroll(@CurrentUser() user: RequestUser) {
    return this.svc.beginEnrollment(user.id, user.email);
  }

  @Post('verify-enrollment')
  @ApiBody({ type: VerifyMfaDto })
  @ApiOperation({ summary: 'Confirm enrollment with 6-digit code; receive recovery codes' })
  verifyEnrollment(@CurrentUser() user: RequestUser, @Body() body: VerifyMfaDto) {
    return this.svc.verifyEnrollment(user.id, body.code);
  }

  @Post('verify')
  @ApiBody({ type: VerifyMfaDto })
  @ApiOperation({ summary: 'Verify TOTP or recovery code at sign-in challenge' })
  async verify(@CurrentUser() user: RequestUser, @Body() body: VerifyMfaDto) {
    const ok = await this.svc.verifyCode(user.id, body.code);
    return { ok };
  }

  @Delete()
  @ApiOperation({ summary: 'Disable 2FA (requires recent password re-auth on client)' })
  disable(@CurrentUser() user: RequestUser) {
    return this.svc.disable(user.id);
  }
}
