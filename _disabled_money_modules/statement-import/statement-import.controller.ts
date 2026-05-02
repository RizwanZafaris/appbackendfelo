import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CommitStatementDto, UploadStatementDto } from './dto/upload-statement.dto';
import { StatementImportService } from './statement-import.service';

@ApiTags('statement-import')
@ApiBearerAuth()
@Controller('statements')
export class StatementImportController {
  constructor(private readonly svc: StatementImportService) {}

  @Post('upload')
  upload(@CurrentUser() user: RequestUser, @Body() dto: UploadStatementDto) {
    return this.svc.upload(user.id, dto.fileUrl, dto.format);
  }

  @Post(':id/parse')
  parse(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.parse(user.id, id);
  }

  @Post(':id/commit')
  commit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitStatementDto,
  ) {
    return this.svc.commit(user.id, id, dto.excludeHashes ?? []);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user.id, id);
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.id, cursor, limit ? parseInt(limit, 10) : 50);
  }
}
