import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { CommitStatementDto, UploadStatementDto } from './dto/statement-import.dto';
import { StatementImportService } from './statement-import.service';

@ApiTags('statement-import')
@ApiBearerAuth()
@Controller('statements')
export class StatementImportController {
  constructor(private readonly svc: StatementImportService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a statement file (CSV, OFX, PDF)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        format: { type: 'string', enum: ['csv', 'ofx', 'pdf'] },
        accountId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadStatementDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const filePath = file?.path ?? `statements/${user.id}/${Date.now()}-${dto.format}`;
    return this.svc.upload(user.id, filePath, file?.originalname ?? `statement.${dto.format}`, dto.format, dto.accountId);
  }

  @Post(':id/parse')
  @ApiOperation({ summary: 'Parse an uploaded statement' })
  parse(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.parse(user.id, id);
  }

  @Post(':id/commit')
  @ApiOperation({ summary: 'Commit parsed rows to transactions' })
  commit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitStatementDto,
  ) {
    return this.svc.commit(user.id, id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List statement imports' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @CurrentUser() user: RequestUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
