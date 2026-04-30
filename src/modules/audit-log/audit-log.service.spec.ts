import { Test } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { auditLogs } from '@db/schema';

import { AuditLogService } from './audit-log.service';

const mockDb = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
};

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [AuditLogService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = mod.get<AuditLogService>(AuditLogService);
  });

  describe('record', () => {
    it('inserts audit log entry', async () => {
      const entry = {
        id: 'a1',
        actorUserId: 'u1',
        entityType: 'transactions',
        operation: 'create' as const,
      };
      mockDb.returning.mockResolvedValue([entry]);

      const result = await service.record({
        actorId: 'u1',
        entityType: 'transactions',
        operation: 'create',
        after: { id: 't1', amount: 100 },
      });

      expect(result.actorUserId).toBe('u1');
      expect(mockDb.insert).toHaveBeenCalledWith(auditLogs);
    });
  });

  describe('findByActor', () => {
    it('returns cursor-paginated results', async () => {
      const items = Array.from({ length: 51 }, (_, i) => ({
        id: `a${i}`,
        actorId: 'u1',
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      }));
      mockDb.limit.mockResolvedValue(items);

      const result = await service.findByActor('u1', { limit: 50 });

      expect(result.items).toHaveLength(50);
      expect(result.nextCursor).toBeDefined();
    });
  });

  describe('findByEntity', () => {
    it('filters by entity type and id', async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await service.findByEntity('transactions', 't1');

      expect(result.items).toEqual([]);
      expect(mockDb.where).toHaveBeenCalled();
    });
  });
});
