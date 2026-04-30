import { Test } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { KYC_PROVIDER } from '@/integrations/kyc/kyc-provider.port';
import { MockKycAdapter } from '@/integrations/kyc/mock-kyc.adapter';
import { kycChecks } from '@db/schema';

import { KycService } from './kyc.service';

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
    kycChecks: { findFirst: jest.fn() },
  },
};

describe('KycService', () => {
  let service: KycService;
  const mockProvider = new MockKycAdapter();

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: KYC_PROVIDER, useValue: mockProvider },
      ],
    }).compile();
    service = mod.get<KycService>(KycService);
  });

  describe('initiate', () => {
    it('creates a kyc check and updates profile', async () => {
      const checkRow = { id: 'k1', userId: 'u1', providerCheckId: 'mock_abc' };
      mockDb.returning.mockResolvedValueOnce([checkRow]);
      mockDb.returning.mockResolvedValueOnce([{}]);

      const result = await service.initiate('u1', {
        firstName: 'Test',
        lastName: 'User',
      });

      expect(result.providerCheckId).toBe('mock_abc');
      expect(mockDb.insert).toHaveBeenCalledWith(kycChecks);
    });
  });

  describe('status', () => {
    it('returns not_started when no checks exist', async () => {
      mockDb.limit.mockResolvedValue([]);
      const result = await service.status('u1');
      expect(result.status).toBe('not_started');
    });

    it('returns latest check when complete', async () => {
      mockDb.limit.mockResolvedValue([
        { id: 'k1', status: 'complete', result: 'clear', providerCheckId: 'mock_abc' },
      ]);
      const result = await service.status('u1');
      expect(result.status).toBe('complete');
    });
  });

  describe('handleWebhook', () => {
    it('acknowledges webhook and updates check', async () => {
      mockDb.query.kycChecks.findFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        providerCheckId: 'mock_abc',
      });
      mockDb.returning.mockResolvedValue([{ id: 'k1' }]);

      const result = await service.handleWebhook('mock', {
        event: 'check.completed',
        providerCheckId: 'mock_abc',
      });

      expect(result.acknowledged).toBe(true);
    });

    it('returns not acknowledged for unknown check', async () => {
      mockDb.query.kycChecks.findFirst.mockResolvedValue(undefined);
      const result = await service.handleWebhook('mock', {
        providerCheckId: 'unknown',
      });
      expect(result.acknowledged).toBe(false);
    });
  });

  describe('review', () => {
    it('updates review result', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'k1', userId: 'u1', result: 'clear', status: 'complete' },
      ]);

      const result = await service.review('k1', {
        result: 'clear',
        reviewedBy: 'admin1',
        note: 'Looks good',
      });

      expect(result.result).toBe('clear');
      expect(result.status).toBe('complete');
    });
  });
});
