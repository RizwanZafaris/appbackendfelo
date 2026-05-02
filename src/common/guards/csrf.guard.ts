import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

/**
 * CSRF Protection using Double-Submit Cookie pattern.
 * Frontend must:
 * 1. Read CSRF-TOKEN cookie (httpOnly=false, so JS can read it)
 * 2. Send X-CSRF-Token header with every mutating request
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);
  private readonly cookieName = 'csrf_token';
  private readonly headerName = 'x-csrf-token';

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method;

    // Safe methods don't need CSRF protection
    if (['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)) {
      this.ensureCsrfCookie(request, response);
      return true;
    }

    // API key / bearer auth bypasses CSRF (they're not cookie-based)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return true;
    }

    const cookieToken = request.cookies?.[this.cookieName];
    const headerToken = request.headers[this.headerName] as string;

    if (!cookieToken || !headerToken) {
      this.logger.warn(`CSRF check failed: missing ${!cookieToken ? 'cookie' : 'header'}`);
      throw new UnauthorizedException('CSRF token missing');
    }

    if (cookieToken !== headerToken) {
      this.logger.warn('CSRF check failed: token mismatch');
      throw new UnauthorizedException('CSRF token invalid');
    }

    return true;
  }

  private ensureCsrfCookie(req: Request, res: Response): void {
    if (!req.cookies?.[this.cookieName]) {
      const token = crypto.randomBytes(32).toString('hex');
      res.cookie(this.cookieName, token, {
        httpOnly: false, // Must be readable by JS
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }
  }
}
