import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { ComplianceService } from './compliance.service';

describe('ComplianceService', () => {
  let service: ComplianceService;

  const mockFlags = [
    { id: 'flag-1', userId: 'user-1', flagType: 'velocity' as const, severity: 'medium' as const, status: 'open' as const, description: 'Too many txns', evidence: {}, assignedTo: null, resolvedAt: null, resolvedBy: null, resolutionNote: null, createdAt: new Date(), updatedAt: new Date() },
    { id: 'flag-2', userId: 'user-2', flagType: 'amount_threshold' as const, severity: 'high' as const, status: 'open' as const, description: 'Large txn', evidence: {}, assignedTo: null, resolvedAt: null, resolvedBy: null, resolutionNote: null, createdAt: new Date(), updatedAt: new Date() },
  ];

  function buildDbStub() {
    let flagsDb = [...mockFlags];
    let transactionsDb = [
      { id: 'txn-1', userId: 'user-1', amountMinor: 6000000, currency: 'CAD', bookedAt: new Date(), merchant: 'Test' },
      { id: 'txn-2', userId: 'user-1', amountMinor: 6000000, currency: 'CAD', bookedAt: new Date(), merchant: 'Test' },
    ];

    return {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(async () => flagsDb),
            })),
            limit: jest.fn(async () => flagsDb.slice(0, 1)),
            groupBy: jest.fn(() => ({
              orderBy: jest.fn(async () => [
                { userId: 'user-1', count: 25 },
                { userId: 'user-2', count: 5 },
              ]),
            })),
          })),
        })),
      })),
      insert: jest.fn((table: string) => ({
        values: jest.fn((vals: Record<string, unknown>) => ({
          returning: jest.fn(async () => {
            if (table === 'compliance_flags') {
              const row = { id: `flag-${flagsDb.length + 1}`, ...vals };
              flagsDb.push(row as typeof mockFlags[0]);
              return [row];
            }
            return [{ id: 'test', ...vals }];
          }),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((patch: Record<string, unknown>) => ({
          where: jest.fn(() => ({
            returning: jest.fn(async () => {
              const idx = flagsDb.findIndex((f) => f.id === 'flag-1');
              if (idx >= 0) {
                flagsDb[idx] = { ...flagsDb[idx], ...patch } as typeof mockFlags[0];
                return [flagsDb[idx]];
              }
              return [{ ...mockFlags[0], ...patch }];
            }),
          })),
        })),
      })),
      query: {
        complianceFlags: {
          findFirst: jest.fn(async () => flagsDb[0]),
        },
      },
      getFlags: () => flagsDb,
    };
  }

  async function buildService(dbStub: unknown) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComplianceService, { provide: DRIZZLE, useValue: dbStub }],
    }).compile();
    return module.get(ComplianceService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getReviewQueue', () => {
    it('returns open flags', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.getReviewQueue();
      expect(result.data.length).toBe(2);
    });

    it('filters by status', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.getReviewQueue({ status: 'open' });
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('patchFlag', () => {
    it('assigns a flag', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.patchFlag('flag-1', { status: 'assigned', assignedTo: 'admin-1' }, 'admin-1');
      expect(result.status).toBe('assigned');
    });

    it('approves a flag with note', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.patchFlag('flag-1', { status: 'approved', resolutionNote: 'Verified legitimate' }, 'admin-1');
      expect(result.status).toBe('approved');
      expect(result.resolvedBy).toBeDefined();
    });

    it('throws for non-existent flag', async () => {
      const db = buildDbStub();
      db.query.complianceFlags.findFirst = jest.fn(async () => null);
      service = await buildService(db);

      await expect(service.patchFlag('nonexistent', { status: 'approved' }, 'admin-1')).rejects.toThrow('Flag not found');
    });
  });

  describe('nightlyScan', () => {
    it('runs without errors', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      await expect(service.nightlyScan()).resolves.not.toThrow();
    });
  });
});
