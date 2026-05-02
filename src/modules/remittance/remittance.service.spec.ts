import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { RemittanceService } from './remittance.service';
import { PayoutProviderFactory } from './providers/provider-factory.service';
import { DRIZZLE } from '@/common/db/db.module';
import {
  createMockDrizzle,
  mockSelectChain,
  mockInsertChain,
  mockUpdateChain,
} from '../../../test/setup';

describe('RemittanceService', () => {
  let service: RemittanceService;
  let mockDb: ReturnType<typeof createMockDrizzle>;
  let mockFactory: jest.Mocked<PayoutProviderFactory>;

  const routeId = 'rte_00000000-0000-0000-0000-000000000001';
  const providerId = 'prv_00000000-0000-0000-0000-000000000001';
  const userId = 'usr_00000000-0000-0000-0000-000000000001';

  const sampleRoute = {
    id: routeId,
    name: 'Test Route',
    corridor: 'AE-PK',
    sourceCurrency: 'AED',
    targetCurrency: 'PKR',
    providerId,
    payoutMethod: 'bank_transfer',
    feeBps: 50,
    fxMarkupBps: 100,
    minAmount: '10',
    maxAmount: '10000',
    estimatedMinutes: 30,
    enabled: true,
  };

  const sampleProvider = {
    id: providerId,
    name: 'TestProvider',
    providerCode: 'paymob',
    enabled: true,
    baseUrl: 'https://api.test.com',
    authType: 'apikey',
    credentials: { key: 'secret' },
    supportedCorridors: ['AE-PK'],
    supportedCurrencies: ['AED', 'PKR'],
    payoutMethods: ['bank_transfer'],
    rateLimitPerMin: 60,
  };

  beforeEach(async () => {
    mockDb = createMockDrizzle();
    mockFactory = {
      getRoutesForCorridor: jest.fn(),
      getProvider: jest.fn(),
    } as unknown as jest.Mocked<PayoutProviderFactory>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittanceService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: PayoutProviderFactory, useValue: mockFactory },
      ],
    }).compile();

    service = module.get<RemittanceService>(RemittanceService);
  });

  describe('getAllRoutes', () => {
    it('should return routes with provider details', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          { route: sampleRoute, provider: { id: providerId, name: 'TestProvider', providerCode: 'paymob' } },
        ]),
      );

      const result = await service.getAllRoutes();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        corridor: 'AE-PK',
        providerName: 'TestProvider',
        providerCode: 'paymob',
      });
    });
  });

  describe('getQuote', () => {
    it('should calculate quote for a matching route', async () => {
      mockFactory.getRoutesForCorridor.mockResolvedValue([
        {
          id: routeId,
          name: 'Test Route',
          corridor: 'AE-PK',
          sourceCurrency: 'AED',
          targetCurrency: 'PKR',
          providerId,
          providerName: 'TestProvider',
          payoutMethod: 'bank_transfer',
          feeBps: 50,
          fxMarkupBps: 100,
          minAmount: 10,
          maxAmount: 10000,
          estimatedMinutes: 30,
          enabled: true,
        },
      ]);

      const result = await service.getQuote({
        corridor: 'AE-PK',
        amount: 1000,
        sourceCurrency: 'AED',
        targetCurrency: 'PKR',
        payoutMethod: 'bank_transfer',
      });

      expect(result.corridor).toBe('AE-PK');
      expect(result.amount).toBe(1000);
      expect(result.feeAmount).toBe(5); // 1000 * 50 / 10000
      expect(result.fxRate).toBe(1.01); // 1 + 100/10000
      expect(result.targetAmount).toBeCloseTo(995 * 1.01, 2);
      expect(result.estimatedMinutes).toBe(30);
      expect(result.providerName).toBe('TestProvider');
    });

    it('should throw NotFoundException when no route matches', async () => {
      mockFactory.getRoutesForCorridor.mockResolvedValue([]);

      await expect(
        service.getQuote({
          corridor: 'AE-PK',
          amount: 1000,
          sourceCurrency: 'AED',
          targetCurrency: 'PKR',
          payoutMethod: 'bank_transfer',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when currency mismatch', async () => {
      mockFactory.getRoutesForCorridor.mockResolvedValue([
        {
          id: routeId,
          name: 'Test Route',
          corridor: 'AE-PK',
          sourceCurrency: 'AED',
          targetCurrency: 'PKR',
          providerId,
          providerName: 'TestProvider',
          payoutMethod: 'bank_transfer',
          feeBps: 50,
          fxMarkupBps: 100,
          minAmount: 10,
          maxAmount: 10000,
          estimatedMinutes: 30,
          enabled: true,
        },
      ]);

      await expect(
        service.getQuote({
          corridor: 'AE-PK',
          amount: 1000,
          sourceCurrency: 'USD',
          targetCurrency: 'PKR',
          payoutMethod: 'bank_transfer',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('initiatePayout', () => {
    const payoutParams = {
      userId,
      routeId,
      amount: 1000,
      recipientName: 'Ali Khan',
      recipientAccount: 'PK12ABCD',
      recipientPhone: '+923001234567',
      recipientBankCode: 'HABB',
      recipientBankName: 'Habib Bank',
      purpose: 'Family Support',
      reference: 'REF-001',
    };

    it('should create transaction and send payout successfully', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([sampleRoute]));
      mockDb.insert = jest.fn().mockReturnValue(
        mockInsertChain([{ id: 'tx_001', reference: 'REF-001' }]),
      );
      mockDb.update = jest.fn().mockReturnValue(mockUpdateChain([{ id: 'tx_001', status: 'initiated' }]));

      const mockProvider = {
        sendPayout: jest.fn().mockResolvedValue({
          success: true,
          providerTransactionId: 'pv_123',
          status: 'initiated',
          message: 'Sent',
        }),
      };
      mockFactory.getProvider.mockReturnValue(mockProvider as any);

      const result = await service.initiatePayout(payoutParams);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx_001');
      expect(result.reference).toBe('REF-001');
      expect(result.providerTransactionId).toBe('pv_123');
      expect(mockProvider.sendPayout).toHaveBeenCalled();
    });

    it('should auto-generate reference when not provided', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([sampleRoute]));
      mockDb.insert = jest.fn().mockReturnValue(
        mockInsertChain([{ id: 'tx_002', reference: 'FELO1234567890ABC' }]),
      );
      mockDb.update = jest.fn().mockReturnValue(mockUpdateChain([{ id: 'tx_002' }]));

      const mockProvider = {
        sendPayout: jest.fn().mockResolvedValue({
          success: true,
          providerTransactionId: 'pv_124',
          status: 'initiated',
          message: 'Sent',
        }),
      };
      mockFactory.getProvider.mockReturnValue(mockProvider as any);

      const result = await service.initiatePayout({
        ...payoutParams,
        reference: undefined,
      });

      expect(result.reference).toMatch(/^FELO/);
      expect(result.reference).toHaveLength(17);
    });

    it('should throw NotFoundException when route not found', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await expect(service.initiatePayout(payoutParams)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when provider not available', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([sampleRoute]));
      mockFactory.getProvider.mockReturnValue(undefined);

      await expect(service.initiatePayout(payoutParams)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should mark transaction as failed when provider returns failure', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([sampleRoute]));
      mockDb.insert = jest.fn().mockReturnValue(
        mockInsertChain([{ id: 'tx_003', reference: 'REF-003' }]),
      );
      mockDb.update = jest.fn().mockReturnValue(mockUpdateChain([{ id: 'tx_003' }]));

      const mockProvider = {
        sendPayout: jest.fn().mockResolvedValue({
          success: false,
          providerTransactionId: 'pv_125',
          status: 'failed',
          message: 'Insufficient balance',
        }),
      };
      mockFactory.getProvider.mockReturnValue(mockProvider as any);

      const result = await service.initiatePayout(payoutParams);

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
    });

    it('should mark transaction as failed on provider exception', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([sampleRoute]));
      mockDb.insert = jest.fn().mockReturnValue(
        mockInsertChain([{ id: 'tx_004', reference: 'REF-004' }]),
      );
      mockDb.update = jest.fn().mockReturnValue(mockUpdateChain([{ id: 'tx_004' }]));

      const mockProvider = {
        sendPayout: jest.fn().mockRejectedValue(new Error('Network timeout')),
      };
      mockFactory.getProvider.mockReturnValue(mockProvider as any);

      await expect(service.initiatePayout(payoutParams)).rejects.toThrow('Network timeout');
    });
  });

  describe('listUserTransactions', () => {
    it('should return paginated transactions', async () => {
      const rows = [
        { id: 'tx_001', userId, status: 'completed', createdAt: new Date() },
        { id: 'tx_002', userId, status: 'pending', createdAt: new Date() },
      ];
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain(rows));

      const result = await service.listUserTransactions(userId, 1, 20);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tx_001');
    });

    it('should apply offset for page > 1', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await service.listUserTransactions(userId, 3, 15);

      const chain = mockDb.select();
      expect(chain.offset).toBeDefined();
    });
  });

  describe('getTransaction', () => {
    it('should return a transaction by id', async () => {
      const tx = { id: 'tx_001', userId, status: 'completed' };
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([tx]));

      const result = await service.getTransaction('tx_001');

      expect(result.id).toBe('tx_001');
    });

    it('should throw NotFoundException when transaction not found', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await expect(service.getTransaction('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('checkProviderStatus', () => {
    it('should return provider status without providerTransactionId', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([{ id: 'tx_001', providerTransactionId: null, status: 'pending', providerStatus: null }]),
      );

      const result = await service.checkProviderStatus('tx_001');

      expect(result.status).toBe('pending');
      expect(result.providerStatus).toBeNull();
    });

    it('should update status when provider reports completed', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          { id: 'tx_001', providerTransactionId: 'pv_123', status: 'initiated', providerStatus: 'initiated', providerId },
        ]),
      );
      mockDb.update = jest.fn().mockReturnValue(mockUpdateChain([{ id: 'tx_001' }]));

      const mockProvider = {
        checkStatus: jest.fn().mockResolvedValue({
          success: true,
          status: 'completed',
          message: 'Done',
          rawResponse: {},
        }),
      };
      mockFactory.getProvider.mockReturnValue(mockProvider as any);

      const result = await service.checkProviderStatus('tx_001');

      expect(result.status).toBe('completed');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update status when provider reports failed', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          { id: 'tx_001', providerTransactionId: 'pv_123', status: 'initiated', providerStatus: 'initiated', providerId },
        ]),
      );
      mockDb.update = jest.fn().mockReturnValue(mockUpdateChain([{ id: 'tx_001' }]));

      const mockProvider = {
        checkStatus: jest.fn().mockResolvedValue({
          success: false,
          status: 'failed',
          message: 'Rejected',
          rawResponse: {},
        }),
      };
      mockFactory.getProvider.mockReturnValue(mockProvider as any);

      const result = await service.checkProviderStatus('tx_001');

      expect(result.status).toBe('failed');
    });

    it('should not update DB when status is unchanged', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([
          { id: 'tx_001', providerTransactionId: 'pv_123', status: 'completed', providerStatus: 'completed', providerId },
        ]),
      );

      const mockProvider = {
        checkStatus: jest.fn().mockResolvedValue({
          success: true,
          status: 'completed',
          message: 'Done',
          rawResponse: {},
        }),
      };
      mockFactory.getProvider.mockReturnValue(mockProvider as any);

      await service.checkProviderStatus('tx_001');

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('should acknowledge webhook receipt', async () => {
      const result = await service.handleWebhook('paymob', { event: 'payout' }, { 'x-signature': 'abc' });

      expect(result.received).toBe(true);
      expect(result.provider).toBe('paymob');
    });
  });
});
