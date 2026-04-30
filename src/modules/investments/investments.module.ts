import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuditLogModule } from '@/modules/audit-log/audit-log.module';

import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { MarketDataService } from './market-data.service';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [ScheduleModule.forRoot(), AuditLogModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, MarketDataService, PortfolioService],
  exports: [InvestmentsService, PortfolioService, MarketDataService],
})
export class InvestmentsModule {}
