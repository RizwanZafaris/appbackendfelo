import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

/**
 * Path A — Supabase Auth handles signup, signin, password reset, MFA.
 * The Flutter client uses supabase_flutter directly, then sends the
 * resulting JWT in `Authorization: Bearer ...` to our /v1/* endpoints.
 *
 * The backend therefore only needs `/auth/me` for echoing identity.
 * Sign-in / sign-up flows live entirely on the Supabase side.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  @Get('me')
  @ApiOperation({ summary: 'Echo back the bearer identity' })
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
