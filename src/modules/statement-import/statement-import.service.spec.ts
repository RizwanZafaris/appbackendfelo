import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { CsvParser } from './parsers/csv.parser';
import { OfxParser } from './parsers/ofx.parser';
import { PdfParser } from './parsers/pdf.parser';
import { StatementImportService } from './statement-import.service';

describe('StatementImportService', () => {
  let service: StatementImportService;

  const mockStatement = {
    id: 'stmt-1',
    userId: 'user-1',
    accountId: null,
    filePath: '/tmp/test.csv',
    fileName: 'test.csv',
    format: 'csv',
    status: 'uploaded',
    rowCount: null,
    duplicateCount: 0,
    importedCount: null,
    parsedRows: [],
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockParsedRows = [
    { date: '2025-01-15', amountMinor: 2547, currency: 'CAD', description: 'STARBUCKS', direction: 'debit' as const },
    { date: '2025-01-16', amountMinor: 10000, currency: 'CAD', description: 'SALARY', direction: 'credit' as const },
  ];

  function buildDbStub() {
    let statementDb = { ...mockStatement };
    let transactionsDb: Array<Record<string, unknown>> = [];

    return {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(async () => [statementDb]),
            })),
            limit: jest.fn(async () => []),
          })),
        })),
      })),
      insert: jest.fn((table: string) => ({
        values: jest.fn((vals: Record<string, unknown>) => ({
          returning: jest.fn(async () => {
            if (table === 'statement_imports') {
              const row = { id: 'stmt-1', ...vals };
              statementDb = row as typeof statementDb;
              return [row];
            }
            if (table === 'transactions') {
              const row = { id: `txn-${transactionsDb.length}`, ...vals };
              transactionsDb.push(row);
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
              statementDb = { ...statementDb, ...patch } as typeof statementDb;
              return [statementDb];
            }),
          })),
        })),
      })),
      query: {
        statementImports: {
          findFirst: jest.fn(async () => statementDb),
        },
      },
      getStatementDb: () => statementDb,
      getTransactions: () => transactionsDb,
      resetTransactions: () => { transactionsDb = []; },
    };
  }

  async function buildService(dbStub: unknown) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatementImportService,
        { provide: DRIZZLE, useValue: dbStub },
        CsvParser,
        OfxParser,
        PdfParser,
      ],
    }).compile();
    return module.get(StatementImportService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('creates a statement import record', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.upload('user-1', '/tmp/test.csv', 'test.csv', 'csv');
      expect(result.format).toBe('csv');
      expect(result.status).toBe('uploaded');
    });
  });

  describe('parse', () => {
    it('parses CSV and stores rows', async () => {
      const db = buildDbStub();
      const csvParser = { parse: jest.fn(async () => mockParsedRows) };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StatementImportService,
          { provide: DRIZZLE, useValue: db },
          { provide: CsvParser, useValue: csvParser },
          { provide: OfxParser, useValue: { parse: jest.fn() } },
          { provide: PdfParser, useValue: { parse: jest.fn() } },
        ],
      }).compile();
      service = module.get(StatementImportService);

      const result = await service.parse('user-1', 'stmt-1');
      expect(result.status).toBe('parsed');
      expect(result.rowCount).toBe(2);
    });

    it('throws when statement is not in uploaded state', async () => {
      const db = buildDbStub();
      db.query.statementImports.findFirst = jest.fn(async () => ({
        ...mockStatement,
        status: 'parsed',
      }));

      service = await buildService(db);
      await expect(service.parse('user-1', 'stmt-1')).rejects.toThrow('already been parsed');
    });
  });

  describe('commit', () => {
    it('inserts transactions skipping duplicates', async () => {
      const db = buildDbStub();
      db.resetTransactions();
      db.query.statementImports.findFirst = jest.fn(async () => ({
        ...mockStatement,
        status: 'parsed',
        parsedRows: mockParsedRows as unknown as Record<string, unknown>[],
      }));

      // Simulate one existing transaction for dedupe
      let selectCallCount = 0;
      db.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => {
              selectCallCount++;
              return selectCallCount === 2 ? [{ id: 'existing-txn' }] : []; // second row is duplicate
            }),
          })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(async () => [db.getStatementDb()]),
          })),
        })),
      }));

      service = await buildService(db);

      const result = await service.commit('user-1', 'stmt-1', {});
      expect(result.importedCount).toBe(1);
      expect(result.duplicateCount).toBe(1);
      expect(result.statement.status).toBe('committed');
    });

    it('throws when no parsed rows exist', async () => {
      const db = buildDbStub();
      db.query.statementImports.findFirst = jest.fn(async () => ({
        ...mockStatement,
        status: 'parsed',
        parsedRows: [],
      }));

      service = await buildService(db);
      await expect(service.commit('user-1', 'stmt-1', {})).rejects.toThrow('No rows to commit');
    });
  });

  describe('list', () => {
    it('returns paginated imports', async () => {
      const db = buildDbStub();
      const mockImports = [
        { ...mockStatement, id: 'stmt-1', createdAt: new Date() },
        { ...mockStatement, id: 'stmt-2', createdAt: new Date(Date.now() - 1000) },
      ];

      db.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(async () => mockImports),
            })),
          })),
        })),
      }));

      service = await buildService(db);
      const result = await service.list('user-1', { limit: 10 });
      expect(result.data.length).toBe(2);
    });
  });
});
