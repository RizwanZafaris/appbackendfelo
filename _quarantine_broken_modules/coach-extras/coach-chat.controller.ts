import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CoachChatService } from './coach-chat.service';

class ChatCoachDto {
  message!: string;
  conversationId?: string;
  provider?: string;
  model?: string;
}

@ApiTags('coach')
@ApiBearerAuth()
@Controller('coach')
export class CoachChatController {
  constructor(private readonly chatSvc: CoachChatService) {}

  @Post('chat')
  @ApiBody({ type: ChatCoachDto })
  @ApiOperation({
    summary: 'LLM-backed Coach chat with prompt versioning and cost tracking',
  })
  async chat(@CurrentUser() user: RequestUser, @Body() body: ChatCoachDto) {
    if (!body.message?.trim()) {
      throw new BadRequestException('Message is required');
    }
    return this.chatSvc.chat(user.id, {
      message: body.message.trim(),
      conversationId: body.conversationId,
      provider: body.provider,
      model: body.model,
    });
  }

  @Get('history')
  @ApiOperation({ summary: 'List chat conversations for the current user' })
  history(@CurrentUser() user: RequestUser) {
    return this.chatSvc.listConversations(user.id);
  }

  @Get('history/:id')
  @ApiOperation({ summary: 'Get a single conversation' })
  detail(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatSvc.getConversation(user.id, id);
  }
}
