import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Admin user shape attached by AdminJwtGuard.
 */
export interface RequestAdmin {
  id: string;
  email: string;
  role: string;
}

/**
 * Inject the authenticated admin user into a controller method.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestAdmin => {
    const req = ctx.switchToHttp().getRequest();
    return req.admin as RequestAdmin;
  },
);
