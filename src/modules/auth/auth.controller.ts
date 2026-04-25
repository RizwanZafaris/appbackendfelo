import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { RequestUser } from '@/common/types/request-user';

import { AuthService } from './auth.service';
import { ExchangeRequestDto, ExchangeResponseDto } from './dto/exchange.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a Firebase ID token for a Felo JWT pair' })
  exchange(@Body() body: ExchangeRequestDto): Promise<ExchangeResponseDto> {
    return this.auth.exchange(body);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user' })
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
