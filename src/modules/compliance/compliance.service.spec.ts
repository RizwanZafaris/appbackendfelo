import { Test } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';

import { ComplianceService } from './compliance.service';

interface MockDb {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  insert: jest.Mock;
  values: jest.Mock;
  returning: jest.Mock;
  update: jest.Mock;
  set: jest.Mock;
  delete: jest.Mock;
}

function createMockDb(): MockDb {
  const m: Partial<MockDb> = {};
  m.select = jest.fn(() => m as never);
  m.from = jest.fn(() => m as never);
  m.where = jest.fn(() => m as never);
  m.orderBy = jest.fn(() => m as never);
  m.limit = jest.fn();
  m.insert = jest.fn(() => m as never);
  m.values = jest.fn(() => m as never);
  m.returning = jest.fn();
  m.update = jest.fn(() => m as never);
  m.set = jest.fn(() => m as never);
  m.delete = jest.fn(() => m as never);
  return m as MockDb;
}

describe('ComplianceService', () => {
  let service: ComplianceService;
  let mockDb: MockDb;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb = createMockDb();
    const mod = await Test.createTestingModule({
      providers: [ComplianceService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = mod.get(ComplianceService);
  });

  describe('decide', () => {
    it('updates flag with reviewer + status + reason', async () => {
      const flag = { id: 'f1', status: 'cleared', reviewerId: 'u1' };
      mockDb.returning.mockResolvedValueOnce([flag]);
      const result = await service.decide('f1', 'u1', 'cleared', 'OK');
      expect(result.status).toBe('cleared');
      expect(mockDb.set).toHaveBeenCalled();
    });

    it('throws NotFound when flag missing', async () => {
      mockDb.returning.mockResolvedValueOnce([]);
      await expect(service.decide('f1', 'u1', 'dismissed')).rejects.toThrow('Flag not found');
    });
  });

  describe('createThreshold', () => {
    it('persists with safe defaults', async () => {
      const t = { id: 't1', ruleKey: 'aggregate_30d_default', thresholdMinor: 5_000_000 };
      mockDb.returning.mockResolvedValueOnce([t]);
      const result = await service.createThreshold({
        ruleKey: 'aggregate_30d_default',
        thresholdMinor: 5_000_000,
      });
      expect(result.ruleKey).toBe('aggregate_30d_default');
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleKey: 'aggregate_30d_default',
          thresholdMinor: 5_000_000,
          windowDays: 30,
          severity: 'medium',
          audience: {},
        }),
      );
    });
  });

  describe('updateThreshold', () => {
    it('throws NotFound when ruleKey missing', async () => {
      mockDb.returning.mockResolvedValueOnce([]);
      await expect(
        service.updateThreshold('missing', { thresholdMinor: 100 }),
      ).rejects.toThrow('Threshold missing not found');
    });
  });

  describe('scanUser', () => {
    it('returns no flags when user has no transactions hitting any rule', async () => {
      // listThresholds returns empty → falls through to defaults
      mockDb.where.mockResolvedValueOnce([]); // dbRules query
      // For each of 3 default rules, evaluate() runs ONE select → returns 0
      mockDb.where.mockResolvedValueOnce([{ total: 0 }]); // aggregate
      mockDb.where.mockResolvedValueOnce([{ max: 0 }]); // single
      mockDb.where.mockResolvedValueOnce([{ c: 0 }]); // count

      const created = await service.scanUser('u1');
      expect(created).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });
});
