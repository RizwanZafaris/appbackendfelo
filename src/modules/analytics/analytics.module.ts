import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DbModule } from '@/common/db/db.module';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsDispatcher } from './analytics-dispatcher.service';
import { GtmSink } from './sinks/gtm.sink';
import { MetaCapiSink } from './sinks/meta-capi.sink';
import { PostgresSink } from './sinks/postgres.sink';
import { ANALYTICS_SINKS } from './sinks/sink.interface';

/**
 * Analytics module — implements D-030 multi-sink dispatcher.
 *
 * Sinks self-register here. Each sink reads its own env vars in
 * its constructor; sinks with missing creds enter stub mode but
 * still appear in the dispatcher list.
 *
 * Adding a new sink (TikTok, Snap, etc.):
 *   1. Implement the AnalyticsSink interface in sinks/<vendor>.sink.ts
 *   2. Add to providers list below
 *   3. Add to ANALYTICS_SINKS factory's injection list
 *
 * No other code changes anywhere in the system.
 */
@Module({
  imports: [DbModule, ConfigModule],
  controllers: [AnalyticsController],
  providers: [
    PostgresSink,
    MetaCapiSink,
    GtmSink,
    AnalyticsDispatcher,
    {
      provide: ANALYTICS_SINKS,
      useFactory: (
        postgres: PostgresSink,
        meta: MetaCapiSink,
        gtm: GtmSink,
      ) => [postgres, meta, gtm],
      inject: [PostgresSink, MetaCapiSink, GtmSink],
    },
  ],
  exports: [AnalyticsDispatcher],
})
export class AnalyticsModule {}
