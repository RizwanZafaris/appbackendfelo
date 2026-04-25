import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CoachService } from './coach.service';

@ApiTags('coach')
@ApiBearerAuth()
@Controller('coach')
export class CoachController {
  constructor(private readonly svc: CoachService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List Coach conversations' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.listConversations(user.id);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Fetch a single Coach conversation' })
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getConversation(user.id, id);
  }

  @Post('conversations')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { messages: { type: 'array', items: { type: 'object' } } },
    },
  })
  @ApiOperation({ summary: 'Start a new Coach conversation' })
  create(@CurrentUser() user: RequestUser, @Body() body: { messages?: unknown[] }) {
    return this.svc.createConversation(user.id, body.messages ?? []);
  }

  @Post('conversations/:id/messages')
  @ApiBody({ schema: { type: 'object' } })
  @ApiOperation({ summary: 'Append a message to a Coach conversation' })
  append(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() message: unknown,
  ) {
    return this.svc.appendMessage(user.id, id, message);
  }

  @Post('queries/increment')
  @ApiOperation({ summary: "Bump today's Coach query counter (rate-limit hook)" })
  incrementDaily(@CurrentUser() user: RequestUser) {
    return this.svc.incrementDailyQuery(user.id);
  }
}
