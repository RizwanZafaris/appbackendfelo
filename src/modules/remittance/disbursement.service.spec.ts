import { ForbiddenException, ConflictException } from '@nestjs/common';

import { DatabaseService } from '@/common/database.service';
import { AuditService } from '@/modules/audit/audit.service';

import { DisbursementService } from './disbursement.service';
import type { SanctionsService } from '@/modules/compliance/sanctions.service';

/**
 * Logic-level tests for DisbursementService. We don't spin up Postgres —
 * we mock the Drizzle query builder enough to drive the branches that
 * matter for compliance (tier=none block, sanctions block, idempotency
 * replay, monthly limit).
 */
describe('DisbursementService', () => {
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;

  const baseDb = (overrides: Record<string, unknown> = {}): DatabaseService => {
    const db: Record<string, unknown> = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => []),
          })),
        })),
      })),
      transaction: jest.fn(async (fn: (tx: unknown) => Promise<number>) =>
        fn({
          select: jest.fn(() => ({
            from: jest.fn(() => ({
              where: jest.fn(async () => [{ total: 0n }]),
            })),
          })),
          insert: jest.fn(() => ({
            values: jest.fn(() => ({
              returning: jest.fn(async () => [{ id: 42 }]),
            })),
          })),
        }),
      ),
      ...overrides,
    };
    return { db } as unknown as DatabaseService;
  };

  const sanctions: Pick<SanctionsService, 'screen'> = {
    screen: jest.fn(async () => ({
      outcome: 'clear' as const,
      matchScore: 0,
      listName: 'none',
      provider: 'stub',
    })),
  };

  beforeEach(() => jest.clearAllMocks());

  it('rejects KYC tier=none', async () => {
    const svc = new DisbursementService(
      baseDb(),
      audit,
      sanctions as unknown as SanctionsService,
    );
    await expect(
      svc.createOrder(1, 'none', {
        methodId: 1,
        amountMinor: 100n,
        currency: 'PKR',
        idempotencyKey: 'unit-test-key-1',
        recipientHash: 'sha256:r',
        userUuid: 'u',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects amount above per-transaction limit', async () => {
    const svc = new DisbursementService(
      baseDb(),
      audit,
      sanctions as unknown as SanctionsService,
    );
    await expect(
      svc.createOrder(1, 'basic', {
        methodId: 1,
        amountMinor: 9_999_999_999n,
        currency: 'PKR',
        idempotencyKey: 'unit-test-key-2',
        recipientHash: 'sha256:r',
        userUuid: 'u',
      }),
    ).rejects.toThrow(/per-transaction limit/);
  });

  it('rejects when sanctions screening returns block', async () => {
    const blockingSanctions = {
      screen: jest.fn(async () => ({
        outcome: 'block' as const,
        matchScore: 100,
        listName: 'OFAC',
        provider: 'stub',
      })),
    } as unknown as SanctionsService;
    const svc = new DisbursementService(baseDb(), audit, blockingSanctions);
    await expect(
      svc.createOrder(1, 'basic', {
        methodId: 1,
        amountMinor: 100n,
        currency: 'PKR',
        idempotencyKey: 'unit-test-key-3',
        recipientHash: 'sha256:bad',
        userUuid: 'u',
      }),
    ).rejects.toThrow(/blocked by compliance/);
  });

  it('returns existing orderId on idempotency replay', async () => {
    const idemDb = baseDb({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => [{ id: 999 }]),
          })),
        })),
      })),
    });
    const svc = new DisbursementService(
      idemDb,
      audit,
      sanctions as unknown as SanctionsService,
    );
    const r = await svc.createOrder(1, 'basic', {
      methodId: 1,
      amountMinor: 100n,
      currency: 'PKR',
      idempotencyKey: 'unit-test-key-replay',
      recipientHash: 'sha256:r',
      userUuid: 'u',
    });
    expect(r).toEqual({ orderId: 999, idempotent: true });
  });

  it('requires idempotencyKey >= 8 chars', async () => {
    const svc = new DisbursementService(
      baseDb(),
      audit,
      sanctions as unknown as SanctionsService,
    );
    await expect(
      svc.createOrder(1, 'basic', {
        methodId: 1,
        amountMinor: 100n,
        currency: 'PKR',
        idempotencyKey: 'short',
        recipientHash: 'sha256:r',
        userUuid: 'u',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
