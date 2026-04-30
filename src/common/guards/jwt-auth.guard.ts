import { CanActivate, Injectable } from '@nestjs/common';

/**
 * No-op shim retained for the Squad 2/3/4 controllers that imported
 * `JwtAuthGuard` from this path. The app-wide guard is `SupabaseJwtGuard`
 * registered via `APP_GUARD` in app.module.ts; that guard already validates
 * every request, so layering this one on top is just a passthrough.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
