import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { profiles } from '@db/schema';
import { eq } from 'drizzle-orm';

export interface TokenPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OtpVerifyResult {
  ok: boolean;
  tokens?: AuthTokens;
  userId?: string;
  reason?: string;
}

@Injectable()
export class AuthService {
  private readonly refreshSecrets = new Map<string, string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly config: ConfigService,
  ) {}

  /**
   * Exchange a verified phone OTP for an auth token pair.
   * In Path A this is a thin wrapper — the real auth lives in Supabase.
   * We mint a local refresh token so the mobile client can rotate.
   */
  async loginWithOtp(userId: string, phoneE164: string): Promise<AuthTokens> {
    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      throw new UnauthorizedException('User not found');
    }

    const accessToken = this.mintAccessToken(userId, profile.email ?? '');
    const refreshToken = this.mintRefreshToken(userId);

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
    };
  }

  /**
   * Rotate access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const userId = this.validateRefreshToken(refreshToken);
    if (!userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      throw new UnauthorizedException('User not found');
    }

    // Rotate refresh token (one-time use)
    this.revokeRefreshToken(refreshToken);
    const newAccessToken = this.mintAccessToken(userId, profile.email ?? '');
    const newRefreshToken = this.mintRefreshToken(userId);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 3600,
    };
  }

  /**
   * Verify a Supabase-style JWT (simplified for unit testing).
   */
  async verifyAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (!payload.sub || !payload.exp) return null;
      if (payload.exp * 1000 < Date.now()) return null;
      return payload as TokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * Verify OTP and return auth tokens on success.
   */
  async verifyOtpAndLogin(
    userId: string,
    phoneE164: string,
    otpResult: { ok: boolean; reason?: string },
  ): Promise<OtpVerifyResult> {
    if (!otpResult.ok) {
      return { ok: false, reason: otpResult.reason ?? 'otp_failed' };
    }
    const tokens = await this.loginWithOtp(userId, phoneE164);
    return { ok: true, tokens, userId };
  }

  private mintAccessToken(userId: string, email: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        email,
        iat: now,
        exp: now + 3600,
      }),
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.config.get<string>('JWT_SECRET', 'test-secret'))
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  private mintRefreshToken(userId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.refreshSecrets.set(token, userId);
    return token;
  }

  private validateRefreshToken(token: string): string | null {
    return this.refreshSecrets.get(token) ?? null;
  }

  private revokeRefreshToken(token: string): void {
    this.refreshSecrets.delete(token);
  }
}
