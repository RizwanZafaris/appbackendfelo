import { Test } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { devices, notifications } from '@db/schema';

import { NotificationsService } from './notifications.service';

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
  delete: jest.fn().mockReturnThis(),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [NotificationsService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = mod.get<NotificationsService>(NotificationsService);
  });

  describe('list', () => {
    it('returns notifications for user', async () => {
      mockDb.limit.mockResolvedValue([
        { id: 'n1', title: 'Test', readAt: null },
      ]);
      const result = await service.list('u1');
      expect(result).toHaveLength(1);
    });

    it('filters unread only when requested', async () => {
      mockDb.limit.mockResolvedValue([{ id: 'n1', readAt: null }]);
      const result = await service.list('u1', { unreadOnly: true });
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('creates a notification', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'n1', title: 'Test', userId: 'u1' },
      ]);
      const result = await service.create('u1', {
        channel: 'inapp',
        type: 'test',
        title: 'Test',
        body: 'Body',
      });
      expect(result.title).toBe('Test');
      expect(mockDb.insert).toHaveBeenCalledWith(notifications);
    });
  });

  describe('unreadCount', () => {
    it('returns count of unread notifications', async () => {
      mockDb.limit.mockResolvedValue([{ c: 5 }]);
      const result = await service.unreadCount('u1');
      expect(result.count).toBe(5);
    });
  });

  describe('markRead', () => {
    it('marks a notification as read', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'n1', readAt: new Date() }]);
      const result = await service.markRead('u1', 'n1');
      expect(result.readAt).toBeDefined();
    });
  });

  describe('markAllRead', () => {
    it('marks all unread as read', async () => {
      const result = await service.markAllRead('u1');
      expect(result.ok).toBe(true);
    });
  });

  describe('registerDevice', () => {
    it('registers a device', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'd1', platform: 'ios', pushToken: 'tok1' },
      ]);
      const result = await service.registerDevice('u1', {
        platform: 'ios',
        pushToken: 'tok1',
      });
      expect(result.platform).toBe('ios');
      expect(mockDb.insert).toHaveBeenCalledWith(devices);
    });
  });

  describe('listDevices', () => {
    it('returns devices for user', async () => {
      mockDb.orderBy.mockResolvedValue([{ id: 'd1' }]);
      const result = await service.listDevices('u1');
      expect(result).toBeDefined();
    });
  });

  describe('metrics', () => {
    it('returns notification metrics', async () => {
      mockDb.limit.mockResolvedValue([{ c: 100 }]);
      mockDb.limit.mockResolvedValue([{ c: 75 }]);
      mockDb.groupBy.mockResolvedValue([
        { type: 'budget_alert', count: 50, readCount: 40 },
      ]);

      const result = await service.metrics(30);

      expect(result.totalSent).toBeDefined();
      expect(result.byType).toBeDefined();
    });
  });
});
