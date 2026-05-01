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

import { ConfirmReceiptDto, UploadReceiptDto } from './dto/upload-receipt.dto';
import { ReceiptOcrService } from './receipt-ocr.service';

@ApiTags('receipts')
@ApiBearerAuth()
@Controller('receipts')
export class ReceiptOcrController {
  constructor(private readonly svc: ReceiptOcrService) {}

  @Post('upload')
  upload(@CurrentUser() user: RequestUser, @Body() dto: UploadReceiptDto) {
    return this.svc.upload(user.id, dto.imageUrl, dto.provider);
  }

  @Post(':id/parse')
  parse(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.parse(user.id, id);
  }

  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReceiptDto,
  ) {
    return this.svc.confirm(user.id, id, dto);
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
