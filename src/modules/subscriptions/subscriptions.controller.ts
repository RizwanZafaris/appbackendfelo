import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly svc: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all subscriptions for the user' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.list(user.id);
  }

  @Get('current')
  @ApiOperation({ summary: 'Most recent subscription (active or otherwise)' })
  current(@CurrentUser() user: RequestUser) {
    return this.svc.current(user.id);
  }
}
