import { Module } from '@nestjs/common';

import { FX_PROVIDER } from '@/integrations/fx/fx-provider.port';
import { MockFxAdapter } from '@/integrations/fx/mock-fx.adapter';
import { OpenExchangeRatesAdapter } from '@/integrations/fx/open-exchange-rates.adapter';

import { FxRatesController } from './fx-rates.controller';
import { FxRatesService } from './fx-rates.service';

const fxProviderFactory = {
  provide: FX_PROVIDER,
  useFactory: (oxr: OpenExchangeRatesAdapter, mock: MockFxAdapter) => {
    // Prefer OXR when app ID is present; fallback to mock.
    return oxr['appId'] ? oxr : mock;
  },
  inject: [OpenExchangeRatesAdapter, MockFxAdapter],
};

@Module({
  controllers: [FxRatesController],
  providers: [FxRatesService, OpenExchangeRatesAdapter, MockFxAdapter, fxProviderFactory],
  exports: [FxRatesService],
})
export class FxRatesModule {}
