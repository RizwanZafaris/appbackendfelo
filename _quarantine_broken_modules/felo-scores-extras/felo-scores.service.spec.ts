import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';

import { DRIZZLE } from '@/common/db/db.module';
import { feloScores, profiles, budgets, goals, recurringBills, transactions } from '@db/schema';

import { FeloScoresService } from './felo-scores.service';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  query: {
    familyGroups: { findFirst: jest.fn() },
    familyMembers: { findFirst: jest.fn() },
    familyInvitations: { findFirst: jest.fn() },
  },
};

describe('FeloScoresService', () => {
  let service: FeloScoresService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [FeloScoresService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = mod.get<FeloScoresService>(FeloScoresService);
  });

  describe('latest', () => {
    it('returns the latest score row', async () => {
      mockDb.limit.mockResolvedValue([
        { id: 'fs1', userId: 'u1', score: 78, calculatedAt: new Date() },
      ]);
      const result = await service.latest('u1');
      expect(result?.score).toBe(78);
    });

    it('returns null when no scores exist', async () => {
      mockDb.limit.mockResolvedValue([]);
      const result = await service.latest('u1');
      expect(result).toBeNull();
    });
  });

  describe('history', () => {
    it('returns score history limited to N', async () => {
      mockDb.limit.mockResolvedValue([
        { id: 'fs1', score: 80 },
        { id: 'fs2', score: 75 },
      ]);
      const result = await service.history('u1', 10);
      expect(result).toHaveLength(2);
      expect(mockDb.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('breakdown', () => {
    it('returns score breakdown with weights', async () => {
      mockDb.limit.mockResolvedValue([
        { id: 'fs1', score: 85, budgetAdherence: 90, goalProgress: 80, billConsistency: 70, calculatedAt: new Date() },
      ]);
      mockDb.where.mockResolvedValueOnce([]); // formula weights

      const result = await service.breakdown('u1');
      expect(result.score).toBe(85);
      expect(result.weights).toBeDefined();
    });
  });

  describe('computeScore', () => {
    it('computes score with default weights', async () => {
      mockDb.limit.mockResolvedValueOnce([{ monthlyIncomeMinor: 100000 }]); // profile
      mockDb.where.mockResolvedValueOnce([]); // formula
      mockDb.where.mockResolvedValueOnce([]); // budgets
      mockDb.groupBy.mockResolvedValueOnce([]); // spent by category
      mockDb.where.mockResolvedValueOnce([]); // goals
      mockDb.where.mockResolvedValueOnce([]); // recurring bills
      mockDb.groupBy.mockResolvedValueOnce([]); // bill transactions
      mockDb.where.mockResolvedValueOnce([{ totalDebit: 50000 }]); // expenses

      const result = await service.computeScore('u1');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.savingsRate).toBe(50); // (100000-50000)/100000 = 50%
    });
  });

  describe('saveScore', () => {
    it('persists computed score and updates profile', async () => {
      mockDb.limit.mockResolvedValueOnce([{ monthlyIncomeMinor: 100000 }]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.groupBy.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.groupBy.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([{ totalDebit: 50000 }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 'fs1', score: 72 }]);
      mockDb.returning.mockResolvedValueOnce([{}]);

      const result = await service.saveScore('u1');
      expect(result.score).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalledWith(feloScores);
    });
  });

  describe('computeAllScores', () => {
    it('computes scores for all users', async () => {
      mockDb.limit.mockResolvedValueOnce([{ monthlyIncomeMinor: 100000 }]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.groupBy.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.groupBy.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([{ totalDebit: 50000 }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 'fs1' }]);
      mockDb.returning.mockResolvedValueOnce([{}]);

      await service.computeAllScores();
      // Should not throw
    });
  });
});
