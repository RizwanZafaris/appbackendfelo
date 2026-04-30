import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import * as crypto from 'crypto';

import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { AdminAuthService } from './admin-auth.service';
import { ConfigRegistryService } from './config-registry.service';
import { VendorCredentialsService } from './vendor-credentials.service';

@UseGuards(SupabaseJwtGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly configRegistry: ConfigRegistryService,
    private readonly vendorCredentials: VendorCredentialsService,
  ) {}

  // ─── Auth ──────────────────────────────────────────────
  @Post('auth/register')
  register(@Body() body: { email: string; displayName: string; credentialId: string }) {
    return this.adminAuth.register(body.email, body.displayName, body.credentialId);
  }

  @Post('auth/login')
  login(@Body() body: { credentialId: string }) {
    return this.adminAuth.login(body.credentialId);
  }

  @Get('auth/me')
  getMe(@Headers('x-admin-token') token: string) {
    const tokenHash = crypto.createHash('sha256').update(token ?? '').digest('hex');
    return this.adminAuth.getMe(tokenHash);
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
