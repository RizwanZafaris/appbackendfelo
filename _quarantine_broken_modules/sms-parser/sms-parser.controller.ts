import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { IngestSmsDto } from './dto/sms-parser.dto';
import { SmsParserService } from './sms-parser.service';

@ApiTags('sms-parser')
@ApiBearerAuth()
@Controller('sms')
export class SmsParserController {
  constructor(private readonly svc: SmsParserService) {}

  @Post('ingest')
  @ApiOperation({ summary: 'Ingest SMS batch — auto-creates transactions on high confidence' })
  ingest(@CurrentUser() user: RequestUser, @Body() dto: IngestSmsDto) {
    return this.svc.ingest(user.id, dto);
  }

  @Get('ingestion-log')
  @ApiOperation({ summary: 'Cursor-paginated ingestion log' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getLog(
    @CurrentUser() user: RequestUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getLog(user.id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('templates')
  @ApiOperation({ summary: 'List active SMS parser templates' })
  getTemplates() {
    return this.svc.getTemplates();
  }
}
