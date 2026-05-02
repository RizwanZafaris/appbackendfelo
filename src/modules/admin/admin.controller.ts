import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import * as crypto from 'crypto';

import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { AdminAuthService } from './admin-auth.service';
import { ConfigRegistryService } from './config-registry.service';
import { VendorCredentialsService } from './vendor-credentials.service';

import { AdminRegisterDto, AdminLoginDto, AdminRefreshDto, MFASetupDto, MFAVerifyDto, MFADisableDto } from './dto/admin.dto';

@UseGuards(SupabaseJwtGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly configRegistry: ConfigRegistryService,
    private readonly vendorCredentials: VendorCredentialsService,
  ) {}

  // ─── Auth (JWT-based) ─────────────────────────────────
  @Post('auth/register')
  register(@Body() body: AdminRegisterDto) {
    return this.adminAuth.register(body.email, body.displayName, body.password, body.role);
  }

  @Post('auth/login')
  async login(@Body() body: AdminLoginDto) {
    return this.adminAuth.login(body.email, body.password, body.totpToken);
  }

  @Post('auth/refresh')
  refreshToken(@Body() body: AdminRefreshDto) {
    return this.adminAuth.refreshAccessToken(body.refreshToken);
  }

  @Get('auth/me')
  getMe(@Headers('authorization') authHeader: string) {
    const token = authHeader?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedException('No token provided');
    return this.adminAuth.getMeFromToken(token);
  }

  // ─── MFA ────────────────────────────────────────────────
  @Post('auth/mfa/setup')
  async setupMFA(@Body() body: MFASetupDto) {
    return this.adminAuth.setupMFA(body.adminId);
  }

  @Post('auth/mfa/verify')
  async verifyMFA(@Body() body: MFAVerifyDto) {
    return this.adminAuth.verifyMFASetup(body.adminId, body.token);
  }

  @Post('auth/mfa/disable')
  async disableMFA(@Body() body: MFADisableDto) {
    return this.adminAuth.disableMFA(body.adminId, body.password);
  }

  @Get('users')
  listUsers() {
    return this.adminAuth.listUsers();
  }

  // ─── Config Registry (P1) ─────────────────────────────
  @Get('v1/config')
  listConfig(
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.configRegistry.list(search, cursor, limit ? parseInt(limit, 10) : 50);
  }

  @Get('v1/config/:key')
  getConfig(@Param('key') key: string) {
    return this.configRegistry.get(key);
  }

  @Post('v1/config')
  createConfig(
    @Body() body: { key: string; value: unknown; description?: string; audience?: unknown },
    @Headers('x-admin-id') adminId?: string,
  ) {
    return this.configRegistry.create(body.key, body.value, body.description, body.audience, adminId);
  }

  @Patch('v1/config/:key')
  updateConfig(
    @Param('key') key: string,
    @Body() body: { value: unknown },
    @Headers('x-admin-id') adminId?: string,
  ) {
    return this.configRegistry.update(key, body.value, adminId);
  }

  @Delete('v1/config/:key')
  deleteConfig(@Param('key') key: string) {
    return this.configRegistry.remove(key);
  }

  // ─── Vendor Credentials (P6) ──────────────────────────
  @Get('v1/vendor-credentials')
  listVendorCredentials(
    @Query('vendorKey') vendorKey?: string,
    @Query('env') env?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vendorCredentials.list(vendorKey, env, cursor, limit ? parseInt(limit, 10) : 50);
  }

  @Post('v1/vendor-credentials')
  upsertVendorCredential(
    @Body() body: { vendorKey: string; env: 'dev' | 'staging' | 'prod'; encryptedValue: string },
    @Headers('x-admin-id') adminId?: string,
  ) {
    return this.vendorCredentials.upsert(body.vendorKey, body.env, body.encryptedValue, adminId);
  }

  @Post('v1/vendor-credentials/:vendorKey/test')
  testVendorConnection(@Param('vendorKey') vendorKey: string) {
    return this.vendorCredentials.testConnection(vendorKey);
  }
}
