import { Module } from '@nestjs/common';
import { RemittanceNotebookController } from './remittance-notebook.controller';
import { RemittanceNotebookService } from './remittance-notebook.service';

@Module({
  controllers: [RemittanceNotebookController],
  providers: [RemittanceNotebookService],
  exports: [RemittanceNotebookService],
})
export class RemittanceNotebookModule {}
