import { Module } from '@nestjs/common';

import { OCR_PROVIDER } from '@/integrations/ocr/ocr-provider.port';
import { GoogleVisionAdapter } from '@/integrations/ocr/google-vision.adapter';
import { MockOcrAdapter } from '@/integrations/ocr/mock-ocr.adapter';

import { ReceiptOcrController } from './receipt-ocr.controller';
import { ReceiptOcrService } from './receipt-ocr.service';

const ocrProviderFactory = {
  provide: OCR_PROVIDER,
  useFactory: (google: GoogleVisionAdapter, mock: MockOcrAdapter) => {
    // Prefer Google Vision when API key is present; fallback to mock.
    return google['apiKey'] ? google : mock;
  },
  inject: [GoogleVisionAdapter, MockOcrAdapter],
};

@Module({
  controllers: [ReceiptOcrController],
  providers: [ReceiptOcrService, GoogleVisionAdapter, MockOcrAdapter, ocrProviderFactory],
  exports: [ReceiptOcrService],
})
export class ReceiptOcrModule {}
