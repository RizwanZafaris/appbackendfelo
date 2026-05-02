import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly jwtSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTokenExpiry = '15m';
  private readonly refreshTokenExpiry = '7d';

  constructor(private readonly configService: ConfigService) {
    this.jwtSecret = this.configService.get<string>('ADMIN_JWT_SECRET') || this.generateSecret();
    this.refreshSecret = this.configService.get<string>('ADMIN_REFRESH_SECRET') || this.generateSecret();
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateTokens(admin: { id: string; email: string; role: string; permissions: string[] }): {
    accessToken: string;
    refreshToken: string;
  } {
    const accessToken = jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        type: 'access',
      },
      this.jwtSecret,
      { expiresIn: this.accessTokenExpiry },
    );

    const refreshToken = jwt.sign(
      {
        sub: admin.id,
        type: 'refresh',
      },
      this.refreshSecret,
      { expiresIn: this.refreshTokenExpiry },
    );

    return { accessToken, refreshToken };
  }

  verifyAccessToken(token: string): AdminTokenPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as AdminTokenPayload;
    } catch (error) {
      this.logger.warn('Invalid admin access token');
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  verifyRefreshToken(token: string): { sub: string } {
    try {
      return jwt.verify(token, this.refreshSecret) as { sub: string };
    } catch (error) {
      this.logger.warn('Invalid admin refresh token');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  // ─── MFA (TOTP) ─────────────────────────────────────────────────

  generateMFASecret(): string {
    return authenticator.generateSecret();
  }

  generateTOTPUri(secret: string, email: string): string {
    return authenticator.keyuri(email, 'Felo Admin', secret);
  }

  verifyTOTP(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }

  generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

  hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  verifyBackupCode(code: string, hashedCodes: string[]): boolean {
    const hash = this.hashBackupCode(code);
    return hashedCodes.includes(hash);
  }
}
