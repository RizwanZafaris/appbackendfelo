import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestUser } from '../types/request-user';

interface JwtPayload {
  sub: string; // felo users.id
  fbUid: string;
  email: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

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

    try {
      const secret = this.cfg.get<string>('JWT_SECRET');
      if (!secret) throw new Error('JWT_SECRET not configured');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret });

      const user: RequestUser = {
        id: payload.sub,
        firebaseUid: payload.fbUid,
        email: payload.email,
      };
      req.user = user;
      return true;
    } catch (err) {
      throw new UnauthorizedException(err instanceof Error ? err.message : 'Invalid token');
    }
  }
}
