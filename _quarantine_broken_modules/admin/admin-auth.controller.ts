import {
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';
import { Public } from '@/common/decorators/public.decorator';

import { AdminAuthService } from './admin-auth.service';

@ApiTags('admin / auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly svc: AdminAuthService) {}

  @Post('register-challenge')
  @Public()
  @ApiOperation({ summary: 'Get WebAuthn registration challenge' })
  registerChallenge() {
    return this.svc.generateRegistrationChallenge();
  }

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register new admin with WebAuthn credential' })
  register(
    @Body() body: {
      email: string;
      displayName: string;
      role?: 'super_admin' | 'ops_manager' | 'support_agent' | 'read_only';
      credential: { id: string; publicKey: string };
    },
  ) {
    return this.svc.register(body);
  }

  @Post('login-challenge')
  @Public()
  @ApiOperation({ summary: 'Get WebAuthn login challenge' })
  async loginChallenge(@Body() body: { credentialId: string }) {
    return this.svc.generateLoginChallenge(body.credentialId);
  }

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Login with WebAuthn assertion' })
  async login(
    @Body() body: { credentialId: string; assertion: Record<string, unknown> },
  ) {
    return this.svc.login(body.credentialId, body.assertion);
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() body: { refreshToken: string }) {
    return this.svc.refresh(body.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin user' })
  async me(@CurrentAdmin() admin: RequestAdmin) {
    if (!admin) throw new UnauthorizedException();
    return this.svc.me(admin.id);
  }
}
