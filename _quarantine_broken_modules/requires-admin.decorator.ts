import { SetMetadata } from '@nestjs/common';

/**
 * Mark a route as requiring admin authentication + specific role.
 * Usage:
 *   @RequiresAdmin('super_admin')
 *   @Get('users')
 *   listUsers() { ... }
 *
 *   @RequiresAdmin() // any admin role
 *   @Get('dashboard')
 *   dashboard() { ... }
 */
export const ADMIN_ROLE_KEY = 'adminRole';
export const IS_ADMIN_KEY = 'isAdmin';

export const RequiresAdmin = (role?: string) =>
  SetMetadata(ADMIN_ROLE_KEY, role ?? 'any');
