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

import { ConfirmReceiptDto, UploadReceiptDto } from './dto/receipt-ocr.dto';
import { ReceiptOcrService } from './receipt-ocr.service';

@ApiTags('receipt-ocr')
@ApiBearerAuth()
@Controller('receipts')
export class ReceiptOcrController {
  constructor(private readonly svc: ReceiptOcrService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a receipt image (multipart/form-data)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadReceiptDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // file.path is the Supabase Storage path after upload
    const filePath = file?.path ?? `uploads/${user.id}/${Date.now()}-${dto.fileName}`;
    return this.svc.upload(user.id, dto, filePath);
  }

  @Post(':id/parse')
  @ApiOperation({ summary: 'Run OCR on an uploaded receipt' })
  parse(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.parse(user.id, id);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm parsed receipt and create transaction' })
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReceiptDto,
  ) {
    return this.svc.confirm(user.id, id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List user receipts (cursor-paginated)' })
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
