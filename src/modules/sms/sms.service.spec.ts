import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { SmsService } from './sms.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SmsService', () => {
  let service: SmsService;

  beforeEach(async () => {
    // Enable all 4 routes for failover tests
    process.env.SMS_ROUTE_1_ENABLED = 'true';
    process.env.SMS_ROUTE_1_API_TOKEN = 'tok1';
    process.env.SMS_ROUTE_1_API_SECRET = 'sec1';
    process.env.SMS_ROUTE_2_ENABLED = 'true';
    process.env.SMS_ROUTE_2_API_KEY = 'key2';
    process.env.SMS_ROUTE_3_ENABLED = 'true';
    process.env.SMS_ROUTE_3_ID = 'id3';
    process.env.SMS_ROUTE_3_PASS = 'pass3';
    process.env.SMS_ROUTE_3_MASK = 'mask3';
    process.env.SMS_ROUTE_4_ENABLED = 'true';
    process.env.SMS_ROUTE_4_KEY = 'key4';

    const module: TestingModule = await Test.createTestingModule({
      providers: [SmsService],
    }).compile();

    service = module.get<SmsService>(SmsService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SMS_ROUTE_1_ENABLED;
    delete process.env.SMS_ROUTE_1_API_TOKEN;
    delete process.env.SMS_ROUTE_1_API_SECRET;
    delete process.env.SMS_ROUTE_2_ENABLED;
    delete process.env.SMS_ROUTE_2_API_KEY;
    delete process.env.SMS_ROUTE_3_ENABLED;
    delete process.env.SMS_ROUTE_3_ID;
    delete process.env.SMS_ROUTE_3_PASS;
    delete process.env.SMS_ROUTE_3_MASK;
    delete process.env.SMS_ROUTE_4_ENABLED;
    delete process.env.SMS_ROUTE_4_KEY;
  });

  describe('sendSms — 4-route failover', () => {
    it('should send via route 1 (lifetimesms) when available', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: 'success', message_id: 'lt_001' },
      });

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Hello',
        type: 'transaction',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('lifetimesms');
      expect(result.messageId).toBe('lt_001');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://lifetimesms.com/json',
        expect.objectContaining({
          api_token: 'tok1',
          api_secret: 'sec1',
          to: '+923001234567',
          message: 'Hello',
        }),
        expect.any(Object),
      );
    });

    it('should failover to route 2 (sendpk) when route 1 fails', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Route 1 timeout'));
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { status: 'success', message_id: 'spk_001' },
      });

      const result = await service.sendSms({
        phoneNumber: '03001234567',
        message: 'Test',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('sendpk');
      expect(result.messageId).toBe('spk_001');
    });

    it('should failover to route 3 (fastsmsalerts) when routes 1-2 fail', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Route 1 fail'));
      mockedAxios.get = jest.fn().mockImplementation((url: string) => {
        if (url.includes('sendpk')) {
          return Promise.reject(new Error('Route 2 fail'));
        }
        return Promise.resolve({ data: 'SMS Sent Successfully' });
      });

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Alert',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('fastsmsalerts');
    });

    it('should failover to route 4 (bsms) when routes 1-3 fail', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Route 1 fail'));
      mockedAxios.get = jest.fn().mockImplementation((url: string) => {
        if (url.includes('sendpk') || url.includes('fastsmsalerts')) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve({ data: { status: 'success' } });
      });

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Your OTP is 123456',
        type: 'otp',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('bsms');
    });

    it('should return all-routes-failed when no route succeeds', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('fail'));
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('fail'));

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Urgent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('All SMS routes failed');
      expect(result.provider).toBe('none');
    });

    it('should return no-routes-configured when all disabled', async () => {
      delete process.env.SMS_ROUTE_1_ENABLED;
      delete process.env.SMS_ROUTE_2_ENABLED;
      delete process.env.SMS_ROUTE_3_ENABLED;
      delete process.env.SMS_ROUTE_4_ENABLED;

      // Re-instantiate to pick up empty routes
      const module: TestingModule = await Test.createTestingModule({
        providers: [SmsService],
      }).compile();
      const freshService = module.get<SmsService>(SmsService);

      const result = await freshService.sendSms({
        phoneNumber: '+923001234567',
        message: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No SMS routes configured');
    });
  });

  describe('phone number formatting', () => {
    it('should normalize numbers starting with 0', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: 'success', message_id: 'lt_002' },
      });

      await service.sendSms({
        phoneNumber: '03001234567',
        message: 'Test',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://lifetimesms.com/json',
        expect.objectContaining({ to: '+923001234567' }),
        expect.any(Object),
      );
    });

    it('should not double-prefix +92 numbers', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: 'success', message_id: 'lt_003' },
      });

      await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Test',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://lifetimesms.com/json',
        expect.objectContaining({ to: '+923001234567' }),
        expect.any(Object),
      );
    });

    it('should add +92 prefix to bare numbers without country code', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: 'success', message_id: 'lt_004' },
      });

      await service.sendSms({
        phoneNumber: '3001234567',
        message: 'Test',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://lifetimesms.com/json',
        expect.objectContaining({ to: '+923001234567' }),
        expect.any(Object),
      );
    });
  });

  describe('route-specific behavior', () => {
    it('lifetimesms: should return failure on error response', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: 'error', message: 'Invalid token' },
      });

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.provider).toBe('lifetimesms');
      expect(result.error).toBe('Invalid token');
    });

    it('sendpk: should accept code 200 as success', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('fail'));
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { code: '200', id: 'spk_999' },
      });

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Test',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('sendpk');
      expect(result.messageId).toBe('spk_999');
    });

    it('fastsmsalerts: should detect success in string response', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('fail'));
      mockedAxios.get = jest.fn().mockImplementation((url: string) => {
        if (url.includes('sendpk')) return Promise.reject(new Error('fail'));
        return Promise.resolve({ data: 'Message Sent Successfully' });
      });

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Test',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('fastsmsalerts');
    });

    it('bsms: should extract OTP code from message for otp type', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('fail'));
      mockedAxios.get = jest.fn().mockImplementation((url: string) => {
        if (url.includes('sendpk') || url.includes('fastsmsalerts')) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve({ data: 'Sent successfully' });
      });

      const result = await service.sendSms({
        phoneNumber: '+923001234567',
        message: 'Your verification code is 987654',
        type: 'otp',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('bsms');
    });
  });

  describe('checkRoutesHealth', () => {
    it('should report up for working routes', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: 'success' },
      });

      const result = await service.checkRoutesHealth();

      expect(result.every((r) => r.status === 'up')).toBe(true);
    });

    it('should report down for failing routes', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Network error'));
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await service.checkRoutesHealth();

      expect(result.every((r) => r.status === 'down')).toBe(true);
      expect(result[0].error).toContain('Network error');
    });
  });
});
