import { Test } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { investments } from '@db/schema';

import { InvestmentsService } from './investments.service';
import { MarketDataService } from './market-data.service';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  query: {
    investments: { findFirst: jest.fn() },
  },
};

const mockMarket = {
  fetchQuote: jest.fn().mockResolvedValue({
    symbol: 'AAPL',
    price: 195.5,
    currency: 'USD',
    source: 'finnhub',
    fetchedAt: new Date(),
  }),
};

describe('InvestmentsService', () => {
  let service: InvestmentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        InvestmentsService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: MarketDataService, useValue: mockMarket },
      ],
    }).compile();
    service = mod.get<InvestmentsService>(InvestmentsService);
  });

  describe('list', () => {
    it('returns active holdings for user', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'i1', symbol: 'AAPL' },
        { id: 'i2', symbol: 'GOOGL' },
      ]);
      const result = await service.list('u1');
      expect(result).toHaveLength(2);
    });
  });

  describe('create', () => {
    it('creates investment with uppercase symbol', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'i1', symbol: 'AAPL', userId: 'u1' },
      ]);

      const result = await service.create('u1', {
        symbol: 'aapl',
        assetClass: 'equity',
        currency: 'USD',
        units: '10',
        costBasisMinor: 50000,
      });

      expect(result.symbol).toBe('AAPL');
      expect(mockDb.insert).toHaveBeenCalledWith(investments);
    });
  });

  describe('updatePrice', () => {
    it('updates price and timestamp', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'i1', lastPriceMinor: 20000 },
      ]);

      const result = await service.updatePrice('u1', 'i1', { lastPriceMinor: 20000 });
      expect(result.lastPriceMinor).toBe(20000);
    });
  });

  describe('archive', () => {
    it('archives the investment', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'i1' }]);
      const result = await service.archive('u1', 'i1');
      expect(result.ok).toBe(true);
    });
  });

  describe('refreshPrices', () => {
    it('fetches and updates prices for all symbols', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'i1', symbol: 'AAPL' },
        { id: 'i2', symbol: 'GOOGL' },
      ]);
      mockDb.set.mockReturnThis();

      await service.refreshPrices();

      expect(mockMarket.fetchQuote).toHaveBeenCalled();
    });
  });
});

describe('MarketDataService', () => {
  let marketService: MarketDataService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        MarketDataService,
        { provide: 'ConfigService', useValue: { get: () => 'test-key' } },
      ],
    }).compile();
    marketService = mod.get<MarketDataService>(MarketDataService);
  });

  describe('fetchQuote', () => {
    it('uses cache when fresh', async () => {
      const freshCache = [
        {
          symbol: 'AAPL',
          priceMinor: 19550,
          currency: 'USD',
          changePercent: '1.5',
          source: 'finnhub',
          fetchedAt: new Date(),
        },
      ];
      mockDb.where.mockResolvedValue(freshCache);

      const result = await marketService.fetchQuote(mockDb as any, 'AAPL');

      expect(result.price).toBe(195.5);
      expect(result.source).toBe('finnhub');
    });
  });
});
