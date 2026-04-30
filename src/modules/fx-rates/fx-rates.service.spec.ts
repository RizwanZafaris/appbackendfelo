import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { FX_PROVIDER } from '@/integrations/fx/fx-provider.port';
import { FxRatesService } from './fx-rates.service';

describe('FxRatesService', () => {
  let service: FxRatesService;

  const mockFxProvider = {
    name: 'mock',
    fetchRate: jest.fn(async (pair: string) => ({
      pair,
      rate: 203.5,
      inverseRate: 1 / 203.5,
      provider: 'mock',
      sourceIndicator: 'seeded' as const,
      expiresAt: new Date(Date.now() + 3600000),
    })),
    buildQuotes: jest.fn(async (_s: string, _t: string, amountMinor: number) => [
      {
        providerCode: 'wise',
        sourceCurrency: 'CAD',
        targetCurrency: 'PKR',
        sourceAmountMinor: amountMinor,
        targetAmountMinor: Math.round((amountMinor / 100) * 203.5 * 100),
        feeMinor: Math.round((amountMinor / 100) * 0.0065 * 100),
        fxRate: 203.5,
        speedHours: 24,
      },
    ]),
  };

  function buildDbStub() {
    return {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(async () => []),
            })),
            limit: jest.fn(async () => []),
          })),
        })),
      })),
      insert: jest.fn((table: string) => ({
        values: jest.fn((vals: Record<string, unknown>) => ({
          returning: jest.fn(async () => [{ id: 'test', ...vals }]),
        })),
      })),
      query: {
        fxSeededRates: {
          findFirst: jest.fn(async () => ({ pair: 'CAD-PKR', rate: '203.50' })),
        },
        remittanceProviders: {
          findFirst: jest.fn(async () => ({
            code: 'wise',
            name: 'Wise',
            isActive: true,
            deliveryMethods: ['bank_deposit', 'mobile_wallet'],
            speedHoursMin: 2,
            speedHoursMax: 48,
          })),
        },
      },
    };
  }

  async function buildService(dbStub: unknown) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxRatesService,
        { provide: DRIZZLE, useValue: dbStub },
        { provide: FX_PROVIDER, useValue: mockFxProvider },
      ],
    }).compile();
    return module.get(FxRatesService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRate', () => {
    it('returns live rate from provider', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.getRate('CAD-PKR');
      expect(result.pair).toBe('CAD-PKR');
      expect(result.rate).toBe(203.5);
      expect(result.provider).toBe('mock');
      expect(mockFxProvider.fetchRate).toHaveBeenCalledWith('CAD-PKR');
    });

    it('falls back to seeded rate when provider returns null', async () => {
      const db = buildDbStub();
      mockFxProvider.fetchRate = jest.fn(async () => null);
      service = await buildService(db);

      const result = await service.getRate('CAD-PKR');
      expect(result.sourceIndicator).toBe('seeded');
      expect(result.rate).toBe(203.5);
    });
  });

  describe('getQuotes', () => {
    it('returns enriched remittance quotes', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.getQuotes({
        source: 'CAD',
        target: 'PKR',
        amountMinor: 100000,
        userId: 'user-1',
      });

      expect(result.source).toBe('CAD');
      expect(result.target).toBe('PKR');
      expect(result.quotes.length).toBe(1);
      expect(result.quotes[0].providerCode).toBe('wise');
      expect(result.quotes[0].providerName).toBe('Wise');
    });
  });
});
