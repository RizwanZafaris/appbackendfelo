import { Module } from '@nestjs/common';
import { CashEnvelopesController } from './cash-envelopes.controller';
import { CashEnvelopesService } from './cash-envelopes.service';

@Module({
  controllers: [CashEnvelopesController],
  providers: [CashEnvelopesService],
  exports: [CashEnvelopesService],
})
export class CashEnvelopesModule {}
