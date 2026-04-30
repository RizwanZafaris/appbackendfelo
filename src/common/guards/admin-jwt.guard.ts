import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { ADMIN_ROLE_KEY } from '@/common/decorators/requires-admin.decorator';
import { adminUsers } from '@db/schema';

const ADMIN_JWT_ALG = 'HS256';

export interface AdminJwtPayload extends JWTPayload {
  sub: string;
  email: string;
  role: string;
  type: 'admin_access' | 'admin_refresh';
}

/**
 * Guard for admin portal endpoints. Verifies admin JWT issued by AdminAuthService.
 * Checks role requirements via @RequiresAdmin(role) decorator.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  private readonly logger = new Logger(AdminJwtGuard.name);
  private secret?: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    private readonly cfg: ConfigService,
    @Inject(DRIZZLE) private readonly db: Drizzle,
  ) {
    const secret = this.cfg.get<string>('ADMIN_JWT_SECRET');
    if (secret) {
      this.secret = new TextEncoder().encode(secret);
    }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<string | undefined>(
      ADMIN_ROLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // Not an admin route — skip
    if (requiredRole === undefined) return true;

    if (!this.secret) {
      throw new UnauthorizedException('Admin auth not configured');
    }

    const req = ctx.switchToHttp().getRequest();
    const auth = (req.headers['authorization'] ?? '') as string;
    if (!auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = auth.slice(7);

    let payload: AdminJwtPayload;
    try {
      const result = await jwtVerify(token, this.secret, {
        algorithms: [ADMIN_JWT_ALG],
        clockTolerance: 60,
      });
      payload = result.payload as unknown as AdminJwtPayload;
    } catch (err) {
      this.logger.warn(`Admin JWT verification failed: ${err}`);
      throw new UnauthorizedException('Invalid admin token');
    }

    if (payload.type !== 'admin_access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Verify admin user still exists and is active
    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, payload.sub),
    });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Admin account inactive');
    }

    // Role check
    if (requiredRole !== 'any' && admin.role !== requiredRole) {
      // ops_manager can access support_agent routes
      const roleHierarchy: Record<string, string[]> = {
        super_admin: ['super_admin', 'ops_manager', 'support_agent', 'read_only'],
        ops_manager: ['ops_manager', 'support_agent', 'read_only'],
        support_agent: ['support_agent', 'read_only'],
        read_only: ['read_only'],
      };
      const allowed = roleHierarchy[admin.role] ?? [];
      if (!allowed.includes(requiredRole)) {
        throw new ForbiddenException('Insufficient admin privileges');
      }
    }

    req.admin = {
      id: payload.sub,
      email: payload.email,
      role: admin.role,
    };
    return true;
  }
}
