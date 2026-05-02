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

  // ─── Admin Management (JWT-based) ────────────────────────────

  private admins: Map<string, any> = new Map();

  register(email: string, displayName: string, password: string, role = 'admin') {
    const id = crypto.randomUUID();
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const admin = {
      id,
      email,
      displayName,
      passwordHash,
      role,
      permissions: this.getDefaultPermissions(role),
      mfaSecret: null as string | null,
      mfaEnabled: false,
      backupCodes: [] as string[],
      createdAt: new Date(),
    };
    this.admins.set(id, admin);
    this.logger.log(`Admin registered: ${email} (${role})`);
    return { id, email, role, message: 'Admin registered successfully' };
  }

  login(email: string, password: string, totpToken?: string) {
    const admin = Array.from(this.admins.values()).find(a => a.email === email);
    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (admin.passwordHash !== passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (admin.mfaEnabled) {
      if (!totpToken) {
        throw new UnauthorizedException('MFA token required');
      }
      if (!this.verifyTOTP(totpToken, admin.mfaSecret!)) {
        throw new UnauthorizedException('Invalid MFA token');
      }
    }

    const tokens = this.generateTokens(admin);
    return {
      ...tokens,
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  }

  refreshAccessToken(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);
    const admin = this.admins.get(payload.sub);
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }
    return this.generateTokens(admin);
  }

  getMeFromToken(token: string) {
    const payload = this.verifyAccessToken(token);
    const admin = this.admins.get(payload.sub);
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }
    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
      permissions: admin.permissions,
      mfaEnabled: admin.mfaEnabled,
    };
  }

  listUsers() {
    return Array.from(this.admins.values()).map(a => ({
      id: a.id,
      email: a.email,
      displayName: a.displayName,
      role: a.role,
      createdAt: a.createdAt,
    }));
  }

  private getDefaultPermissions(role: string): string[] {
    const perms: Record<string, string[]> = {
      superadmin: ['*'],
      admin: ['config:read', 'config:write', 'vendor:read', 'vendor:write', 'users:read', 'transactions:read', 'support:read', 'support:write'],
      viewer: ['config:read', 'vendor:read', 'users:read', 'transactions:read', 'support:read'],
    };
    return perms[role] || perms.viewer;
  }

  // ─── MFA (TOTP) ─────────────────────────────────────────────────

  setupMFA(adminId: string) {
    const admin = this.admins.get(adminId);
    if (!admin) throw new UnauthorizedException('Admin not found');

    const secret = this.generateMFASecret();
    const uri = this.generateTOTPUri(secret, admin.email);
    const backupCodes = this.generateBackupCodes();
    const hashedCodes = backupCodes.map(c => this.hashBackupCode(c));

    admin.mfaSecret = secret;
    admin.backupCodes = hashedCodes;

    return {
      secret,
      uri,
      backupCodes,
      message: 'Scan QR code with authenticator app and verify to enable MFA',
    };
  }

  verifyMFASetup(adminId: string, token: string) {
    const admin = this.admins.get(adminId);
    if (!admin) throw new UnauthorizedException('Admin not found');

    if (!admin.mfaSecret) {
      throw new UnauthorizedException('MFA setup not initiated');
    }

    if (!this.verifyTOTP(token, admin.mfaSecret)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    admin.mfaEnabled = true;
    return { mfaEnabled: true, message: 'MFA enabled successfully' };
  }

  disableMFA(adminId: string, password: string) {
    const admin = this.admins.get(adminId);
    if (!admin) throw new UnauthorizedException('Admin not found');

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (admin.passwordHash !== passwordHash) {
      throw new UnauthorizedException('Invalid password');
    }

    admin.mfaEnabled = false;
    admin.mfaSecret = null;
    admin.backupCodes = [];
    return { mfaEnabled: false, message: 'MFA disabled successfully' };
  }

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
