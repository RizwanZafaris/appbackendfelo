import { Module } from '@nestjs/common';

import { GoogleVisionAdapter } from './adapters/google-vision.adapter';
import { MockOcrAdapter } from './adapters/mock-ocr.adapter';
import { ReceiptOcrController } from './receipt-ocr.controller';
import { ReceiptOcrService } from './receipt-ocr.service';

@Module({
  controllers: [ReceiptOcrController],
  providers: [GoogleVisionAdapter, MockOcrAdapter, ReceiptOcrService],
  exports: [ReceiptOcrService],
})
export class ReceiptOcrModule {}
