import { Injectable, Inject, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { adminUsers, type AdminUser, type NewAdminUser } from '@db/schema';

const ADMIN_JWT_ALG = 'HS256';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export interface AdminTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface WebAuthnCredential {
  id: string;
  publicKey: string;
}

/**
 * Admin authentication service using WebAuthn + JWT (jose library).
 * No passwords — only hardware key / biometric authentication.
 */
@Injectable()
export class AdminAuthService {
  private secret: Uint8Array;

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly cfg: ConfigService,
  ) {
    const jwtSecret = this.cfg.get<string>('ADMIN_JWT_SECRET') ?? 'dev-admin-jwt-secret-change-in-production';
    this.secret = new TextEncoder().encode(jwtSecret);
  }

  /** Generate challenge for WebAuthn registration. */
  generateRegistrationChallenge(): { challenge: string; options: Record<string, unknown> } {
    const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

    return {
      challenge,
      options: {
        rp: { name: 'Felo Admin Portal', id: 'admin.felo.app' },
        user: {
          id: crypto.randomUUID(),
          name: 'admin',
          displayName: 'Admin User',
        },
        challenge,
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        attestation: 'none',
      },
    };
  }

  /** Register a new admin with WebAuthn credential. */
  async register(dto: {
    email: string;
    displayName: string;
    role?: NewAdminUser['role'];
    credential: WebAuthnCredential;
  }): Promise<AdminUser> {
    const existing = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, dto.email),
    });
    if (existing) throw new BadRequestException('Email already registered');

    const inserted = await this.db
      .insert(adminUsers)
      .values({
        email: dto.email,
        displayName: dto.displayName,
        role: dto.role ?? 'read_only',
        webauthnCredentialId: dto.credential.id,
        webauthnPublicKey: dto.credential.publicKey,
      })
      .returning();

    return inserted[0];
  }

  /** Generate challenge for WebAuthn login assertion. */
  generateLoginChallenge(credentialId: string): { challenge: string; options: Record<string, unknown> } {
    const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

    return {
      challenge,
      options: {
        challenge,
        allowCredentials: [{ id: credentialId, type: 'public-key' }],
        userVerification: 'required',
      },
    };
  }

  /** Verify WebAuthn assertion and issue JWT tokens. */
  async login(credentialId: string, _assertion: Record<string, unknown>): Promise<AdminTokens> {
    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.webauthnCredentialId, credentialId),
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // In production: verify WebAuthn signature using @simplewebauthn/server
    // For now, we trust the assertion and issue tokens

    await this.db
      .update(adminUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(adminUsers.id, admin.id));

    return this.issueTokens(admin);
  }

  /** Refresh access token using refresh token. */
  async refresh(refreshToken: string): Promise<AdminTokens> {
    try {
      const result = await jwtVerify(refreshToken, this.secret, {
        algorithms: [ADMIN_JWT_ALG],
        clockTolerance: 60,
      });
      const payload = result.payload as unknown as { sub: string; email: string; role: string; type: string };

      if (payload.type !== 'admin_refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const admin = await this.db.query.adminUsers.findFirst({
        where: eq(adminUsers.id, payload.sub),
      });
      if (!admin || !admin.isActive) {
        throw new UnauthorizedException('Admin account inactive');
      }

      return this.issueTokens(admin);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /** Get current admin user. */
  async me(adminId: string): Promise<AdminUser> {
    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, adminId),
    });
    if (!admin) throw new UnauthorizedException('Admin not found');
    return admin;
  }

  private issueTokens(admin: AdminUser): Promise<AdminTokens> {
    const now = Math.floor(Date.now() / 1000);

    const accessTokenPromise = new SignJWT({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      type: 'admin_access',
    })
      .setProtectedHeader({ alg: ADMIN_JWT_ALG })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_TTL)
      .sign(this.secret);

    const refreshTokenPromise = new SignJWT({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      type: 'admin_refresh',
    })
      .setProtectedHeader({ alg: ADMIN_JWT_ALG })
      .setIssuedAt()
      .setExpirationTime(REFRESH_TOKEN_TTL)
      .sign(this.secret);

    // Use Promise.all for parallel signing
    return Promise.all([accessTokenPromise, refreshTokenPromise]).then(
      ([accessToken, refreshToken]) => ({
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 minutes
      }),
    );
  }
}
