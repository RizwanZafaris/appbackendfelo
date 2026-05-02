import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

/**
 * Factory for a mock Drizzle database that returns predictable data.
 * Use in service-level unit tests instead of a real database.
 */
export function createMockDrizzle(
  overrides: Partial<MockDrizzle> = {},
): MockDrizzle {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      then: jest.fn().mockResolvedValue([]),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
    execute: jest.fn().mockResolvedValue([]),
    query: {
      transactions: {
        findFirst: jest.fn().mockResolvedValue(undefined),
      },
      accounts: {
        findFirst: jest.fn().mockResolvedValue(undefined),
      },
    },
    ...overrides,
  } as unknown as MockDrizzle;
}

export interface MockDrizzle {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  execute: jest.Mock;
  query: {
    transactions: { findFirst: jest.Mock };
    accounts: { findFirst: jest.Mock };
  };
}

/** Build a chainable select builder that resolves to `data`. */
export function mockSelectChain(data: any[]) {
  const self = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation((cb: any) => Promise.resolve(data).then(cb)),
    [Symbol.iterator]: undefined,
  };
  return self;
}

/** Build a chainable insert builder that resolves to `data`. */
export function mockInsertChain(data: any[]) {
  return {
    values: jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue(data),
    }),
  };
}

/** Build a chainable update builder that resolves to `data`. */
export function mockUpdateChain(data: any[]) {
  return {
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue(data),
      }),
    }),
  };
}

/** Build a chainable delete builder that resolves to `data`. */
export function mockDeleteChain(data: any[]) {
  return {
    where: jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue(data),
    }),
  };
}

/** NestJS app factory for controller e2e-ish tests. */
export async function createTestApp(module: TestingModule): Promise<INestApplication> {
  const app = module.createNestApplication();
  await app.init();
  return app;
}

/** Standard test user injected by CurrentUser decorator. */
export const testUser = Object.freeze({
  id: 'usr_00000000-0000-0000-0000-000000000001',
  firebaseUid: 'fb_123456',
  email: 'test@felo.app',
});

/** A fake request object with `user` populated. */
export function mockRequest(user = testUser) {
  return { user } as any;
}

/** A fake ExecutionContext for param-decorator tests. */
export function mockExecutionContext(req = mockRequest()) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as any;
}

export function mockConfigService(values: Record<string, any> = {}) {
  return {
    get: jest.fn((key: string, fallback?: any) => values[key] ?? fallback),
  };
}

/** Clean up module-level side effects between test runs. */
export function cleanupEnv(...keys: string[]) {
  keys.forEach((k) => delete process.env[k]);
}
