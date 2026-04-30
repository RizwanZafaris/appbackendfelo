import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { OCR_PROVIDER } from '@/integrations/ocr/ocr-provider.port';
import { ReceiptOcrService } from './receipt-ocr.service';

describe('ReceiptOcrService', () => {
  let service: ReceiptOcrService;

  const mockOcrProvider = {
    name: 'mock',
    parse: jest.fn(async () => ({
      merchant: 'Test Store',
      merchantAddress: '123 Main St',
      date: '2025-01-15',
      totalMinor: 2547,
      currency: 'CAD',
      taxMinor: 331,
      lineItems: [{ name: 'Item A', quantity: 1, unitPriceMinor: 2547, totalMinor: 2547 }],
      rawText: 'Test Store\n123 Main St\n$25.47',
      confidence: 0.95,
    })),
  };

  const mockReceipt = {
    id: 'receipt-1',
    userId: 'user-1',
    filePath: 'uploads/user-1/test.jpg',
    fileName: 'test.jpg',
    mimeType: 'image/jpeg',
    status: 'uploaded',
    parsedData: {},
    ocrProvider: null,
    transactionId: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function buildDbStub() {
    const receiptsDb = { ...mockReceipt };
    let usageCount = 0;

    return {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(async () => [receiptsDb]),
            })),
            limit: jest.fn(async () => [receiptsDb]),
          })),
        })),
      })),
      insert: jest.fn((table: string) => ({
        values: jest.fn((vals: Record<string, unknown>) => ({
          returning: jest.fn(async () => [{
            id: table === 'receipts' ? 'receipt-1' : 'txn-1',
            ...vals,
          }]),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn(async () => [{
              ...receiptsDb,
              ...((mockOcrProvider.parse as jest.Mock).mock.results[0]?.value ?? {}),
            }]),
          })),
        })),
      })),
      query: {
        receipts: {
          findFirst: jest.fn(async () => receiptsDb),
        },
        subscriptionUsage: {
          findFirst: jest.fn(async () => ({
            userId: 'user-1',
            usageDate: new Date().toISOString().split('T')[0],
            receiptOcrCount: usageCount,
          })),
        },
      },
      setUsageCount: (n: number) => { usageCount = n; },
    };
  }

  async function buildService(dbStub: unknown) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptOcrService,
        { provide: DRIZZLE, useValue: dbStub },
        { provide: OCR_PROVIDER, useValue: mockOcrProvider },
      ],
    }).compile();
    return module.get(ReceiptOcrService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('creates a receipt record', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.upload('user-1', {
        fileName: 'test.jpg',
        mimeType: 'image/jpeg',
      }, 'uploads/user-1/test.jpg');

      expect(result.fileName).toBe('test.jpg');
      expect(result.status).toBe('uploaded');
    });
  });

  describe('parse', () => {
    it('runs OCR and updates receipt status to parsed', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      // Override the update returning to simulate parsed status
      db.update = jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn(async () => [{
              ...mockReceipt,
              status: 'parsed',
              parsedData: { merchant: 'Test Store', totalMinor: 2547 },
              ocrProvider: 'mock',
            }]),
          })),
        })),
      }));

      const result = await service.parse('user-1', 'receipt-1');
      expect(mockOcrProvider.parse).toHaveBeenCalled();
      expect(result.status).toBe('parsed');
    });

    it('throws when quota is exceeded', async () => {
      const db = buildDbStub();
      db.setUsageCount(999);
      service = await buildService(db);

      await expect(service.parse('user-1', 'receipt-1')).rejects.toThrow('OCR quota exceeded');
    });
  });

  describe('confirm', () => {
    it('creates transaction from confirmed receipt', async () => {
      const db = buildDbStub();
      // Simulate parsed receipt
      db.query.receipts.findFirst = jest.fn(async () => ({
        ...mockReceipt,
        status: 'parsed',
        parsedData: { merchant: 'Test Store', totalMinor: 2547 },
      }));

      service = await buildService(db);

      const result = await service.confirm('user-1', 'receipt-1', {
        totalMinor: 2547,
        currency: 'CAD',
        merchant: 'Test Store',
        direction: 'debit',
      });

      expect(result.transaction.amountMinor).toBe(2547);
      expect(result.transaction.source).toBe('ocr');
      expect(result.receipt.status).toBe('confirmed');
    });

    it('throws when receipt is not in parsed state', async () => {
      const db = buildDbStub();
      db.query.receipts.findFirst = jest.fn(async () => ({
        ...mockReceipt,
        status: 'uploaded',
      }));

      service = await buildService(db);

      await expect(
        service.confirm('user-1', 'receipt-1', { totalMinor: 100, currency: 'CAD' }),
      ).rejects.toThrow('Receipt must be parsed before confirming');
    });
  });

  describe('list', () => {
    it('returns paginated receipts', async () => {
      const db = buildDbStub();
      const mockReceipts = Array.from({ length: 5 }, (_, i) => ({
        ...mockReceipt,
        id: `receipt-${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));

      db.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(async () => mockReceipts.slice(0, 2)),
            })),
          })),
        })),
      }));

      service = await buildService(db);
      const result = await service.list('user-1', { limit: 2 });
      expect(result.data.length).toBe(2);
    });
  });
});
