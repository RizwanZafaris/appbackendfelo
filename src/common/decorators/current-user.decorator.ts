import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { RequestUser } from '../types/request-user';

/**
 * Inject the authenticated user into a controller method.
 * Resolves to RequestUser populated by JwtAuthGuard + CurrentUserMiddleware.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as RequestUser;
  },
);
