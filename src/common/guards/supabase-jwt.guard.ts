import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, JWTVerifyResult } from 'jose';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestUser } from '../types/request-user';

/**
 * Verifies Supabase Auth JWTs using the project's JWKS public keys.
 *
 *   - Tokens are signed by Supabase Auth with ECC P-256 (or HS256 legacy).
 *   - We never need a shared secret; the public JWK is fetched and cached
 *     from <project>/auth/v1/.well-known/jwks.json.
 *   - The `sub` claim is the auth.users.id, which equals profiles.id.
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseJwtGuard.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private legacySecret?: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    private readonly cfg: ConfigService,
  ) {
    const jwksUrl = this.cfg.get<string>('SUPABASE_JWKS_URL');
    if (jwksUrl) {
      this.jwks = createRemoteJWKSet(new URL(jwksUrl), {
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      });
    }

    // Optional: also accept HS256 tokens signed with the legacy secret.
    const legacy = this.cfg.get<string>('SUPABASE_LEGACY_JWT_SECRET');
    if (legacy) {
      this.legacySecret = new TextEncoder().encode(legacy);
    }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth = (req.headers['authorization'] ?? '') as string;
    if (!auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = auth.slice(7);

    let verified: JWTVerifyResult | undefined;
    let lastError: unknown;

    if (this.jwks) {
      try {
        verified = await jwtVerify(token, this.jwks, {
          algorithms: ['ES256'],
        });
      } catch (err) {
        lastError = err;
      }
    }

    // Fallback: legacy HS256 path for in-flight tokens issued before key rotation.
    if (!verified && this.legacySecret) {
      try {
        verified = await jwtVerify(token, this.legacySecret, {
          algorithms: ['HS256'],
        });
      } catch (err) {
        lastError = err;
      }
    }

    if (!verified) {
      this.logger.warn(`JWT verification failed: ${lastError}`);
      throw new UnauthorizedException('Invalid token');
    }

    const payload = verified.payload as Record<string, unknown> & {
      sub?: string;
      email?: string;
      phone?: string;
    };

    if (!payload.sub) {
      throw new UnauthorizedException('Token missing sub claim');
    }

    const user: RequestUser = {
      id: payload.sub,
      firebaseUid: payload.sub, // legacy field — same value
      email: payload.email ?? '',
    };
    req.user = user;
    return true;
  }
}
