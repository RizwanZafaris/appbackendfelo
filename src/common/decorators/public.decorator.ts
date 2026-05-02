import { SetMetadata } from '@nestjs/common';

/**
 * Mark a route as publicly accessible (skip SupabaseJwtGuard).
 * Usage:
 *   @Public()
 *   @Get('health')
 *   ping() { ... }
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
