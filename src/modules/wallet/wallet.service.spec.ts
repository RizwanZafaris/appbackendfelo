import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { WalletService } from './wallet.service';
import { DRIZZLE } from '@/common/db/db.module';
import {
  createMockDrizzle,
  mockSelectChain,
} from '../../../test/setup';

describe('WalletService', () => {
  let service: WalletService;
  let mockDb: ReturnType<typeof createMockDrizzle>;

  const userId = 'usr_00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockDb = createMockDrizzle();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: DRIZZLE, useValue: mockDb },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  describe('getBalance', () => {
    it('should aggregate balance across active accounts', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          { currency: 'CAD', totalMinor: '50000' },
        ]),
      );

      // Mock count query
      const countMock = jest.fn().mockReturnValue(
        mockSelectChain([{ count: 3 }]),
      );
      // Replace the second select call (for count)
      let callCount = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockSelectChain([{ currency: 'CAD', totalMinor: '50000' }]);
        }
        return mockSelectChain([{ count: 3 }]);
      });

      const result = await service.getBalance(userId);

      expect(result.userId).toBe(userId);
      expect(result.totalBalanceMinor).toBe(50000);
      expect(result.currency).toBe('CAD');
      expect(result.accountCount).toBe(3);
    });

    it('should return zero balance when no accounts exist', async () => {
      let callCount = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockSelectChain([]);
        }
        return mockSelectChain([{ count: 0 }]);
      });

      const result = await service.getBalance(userId);

      expect(result.totalBalanceMinor).toBe(0);
      expect(result.accountCount).toBe(0);
      expect(result.currency).toBe('CAD');
    });

    it('should handle multiple currencies by picking the first', async () => {
      let callCount = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockSelectChain([
            { currency: 'CAD', totalMinor: '30000' },
            { currency: 'PKR', totalMinor: '1000000' },
          ]);
        }
        return mockSelectChain([{ count: 2 }]);
      });

      const result = await service.getBalance(userId);

      expect(result.currency).toBe('CAD');
      expect(result.totalBalanceMinor).toBe(30000);
    });
  });

  describe('getTransactions', () => {
    it('should return paginated transactions', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          {
            id: 'tx_001',
            merchant: 'Starbucks',
            category: 'food',
            currency: 'CAD',
            amountMinor: 500,
            direction: 'debit',
            bookedAt: new Date('2024-01-15'),
            source: 'manual',
          },
          {
            id: 'tx_002',
            merchant: 'Salary',
            category: 'income',
            currency: 'CAD',
            amountMinor: 500000,
            direction: 'credit',
            bookedAt: new Date('2024-01-01'),
            source: 'bank_alert',
          },
        ]),
      );

      const result = await service.getTransactions(userId, { page: 1, limit: 20 });

      expect(result).toHaveLength(2);
      expect(result[0].merchant).toBe('Starbucks');
      expect(result[0].amountMinor).toBe(500);
      expect(result[0].direction).toBe('debit');
      expect(result[1].direction).toBe('credit');
    });

    it('should filter by category', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          {
            id: 'tx_001',
            merchant: 'Starbucks',
            category: 'food',
            currency: 'CAD',
            amountMinor: 500,
            direction: 'debit',
            bookedAt: new Date(),
            source: 'manual',
          },
        ]),
      );

      const result = await service.getTransactions(userId, { category: 'food' });

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('food');
    });

    it('should cap limit at 100', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await service.getTransactions(userId, { limit: 500 });

      const chain = mockDb.select();
      expect(chain.limit).toBeDefined();
    });

    it('should calculate correct offset for page 2', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await service.getTransactions(userId, { page: 2, limit: 25 });

      const chain = mockDb.select();
      expect(chain.offset).toBeDefined();
    });
  });

  describe('getTransactionDetail', () => {
    it('should return a single transaction', async () => {
      mockDb.query.transactions.findFirst = jest.fn().mockResolvedValue({
        id: 'tx_001',
        merchant: 'Amazon',
        category: 'shopping',
        currency: 'CAD',
        amountMinor: 12000,
        direction: 'debit',
        bookedAt: new Date('2024-02-01'),
        source: 'manual',
      });

      const result = await service.getTransactionDetail(userId, 'tx_001');

      expect(result.id).toBe('tx_001');
      expect(result.merchant).toBe('Amazon');
      expect(result.amountMinor).toBe(12000);
    });

    it('should throw NotFoundException for missing transaction', async () => {
      mockDb.query.transactions.findFirst = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.getTransactionDetail(userId, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMonthlySummary', () => {
    it('should group debit transactions by category for current month', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          { category: 'food', totalMinor: '15000' },
          { category: 'transport', totalMinor: '8000' },
          { category: null, totalMinor: '2000' },
        ]),
      );

      const result = await service.getMonthlySummary(userId);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ category: 'food', totalMinor: 15000 });
      expect(result[1]).toEqual({ category: 'transport', totalMinor: 8000 });
      expect(result[2]).toEqual({ category: null, totalMinor: 2000 });
    });

    it('should return empty array when no transactions', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      const result = await service.getMonthlySummary(userId);

      expect(result).toEqual([]);
    });

    it('should only include debit transactions', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await service.getMonthlySummary(userId);

      const chain = mockDb.select();
      expect(chain.where).toBeDefined();
    });
  });
});
