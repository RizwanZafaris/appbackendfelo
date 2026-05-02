import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthService, AuthTokens } from './auth.service';
import { DRIZZLE } from '@/common/db/db.module';
import { createMockDrizzle, mockSelectChain, mockConfigService } from '../../../test/setup';

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: ReturnType<typeof createMockDrizzle>;
  let mockCfg: ReturnType<typeof mockConfigService>;

  const userId = 'usr_00000000-0000-0000-0000-000000000001';
  const email = 'test@felo.app';
  const phone = '+923001234567';

  beforeEach(async () => {
    mockDb = createMockDrizzle();
    mockCfg = mockConfigService({ 'JWT_SECRET': 'test-secret-key' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('loginWithOtp', () => {
    it('should mint access and refresh tokens for an existing user', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([{ id: userId, email }]),
      );

      const result = await service.loginWithOtp(userId, phone);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(3600);
      expect(result.accessToken.split('.')).toHaveLength(3);
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await expect(service.loginWithOtp(userId, phone)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('should return payload for a valid token', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([{ id: userId, email }]));
      const { accessToken } = await service.loginWithOtp(userId, phone);

      const payload = await service.verifyAccessToken(accessToken);

      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe(userId);
      expect(payload!.email).toBe(email);
      expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should return null for an invalid token format', async () => {
      const result = await service.verifyAccessToken('not-a-jwt');
      expect(result).toBeNull();
    });

    it('should return null for an expired token', async () => {
      const expiredToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiIxIiwiZW1haWwiOiJ0QHQuY29tIiwiZXhwIjoxfQ.' +
        'signature';
      const result = await service.verifyAccessToken(expiredToken);
      expect(result).toBeNull();
    });
  });

  describe('refreshToken', () => {
    it('should rotate tokens with a valid refresh token', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([{ id: userId, email }]),
      );

      const first = await service.loginWithOtp(userId, phone);
      const rotated = await service.refreshToken(first.refreshToken);

      expect(rotated.accessToken).not.toBe(first.accessToken);
      expect(rotated.refreshToken).not.toBe(first.refreshToken);
      expect(rotated.expiresIn).toBe(3600);
    });

    it('should throw UnauthorizedException for an invalid refresh token', async () => {
      await expect(service.refreshToken('invalid-refresh')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should invalidate the old refresh token after rotation', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([{ id: userId, email }]),
      );

      const first = await service.loginWithOtp(userId, phone);
      await service.refreshToken(first.refreshToken);

      await expect(service.refreshToken(first.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user no longer exists', async () => {
      mockDb.select = jest.fn().mockReturnValue(mockSelectChain([]));

      await expect(service.refreshToken('any-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('verifyOtpAndLogin', () => {
    it('should return tokens on successful OTP verification', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([{ id: userId, email }]),
      );

      const result = await service.verifyOtpAndLogin(userId, phone, { ok: true });

      expect(result.ok).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.tokens).toBeDefined();
      expect(result.tokens!.accessToken).toBeDefined();
      expect(result.tokens!.refreshToken).toBeDefined();
    });

    it('should return failure reason on unsuccessful OTP', async () => {
      const result = await service.verifyOtpAndLogin(userId, phone, {
        ok: false,
        reason: 'expired',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('expired');
      expect(result.tokens).toBeUndefined();
    });

    it('should default reason to otp_failed when missing', async () => {
      const result = await service.verifyOtpAndLogin(userId, phone, { ok: false });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('otp_failed');
    });
  });

  describe('token structure', () => {
    it('should produce a JWT with HS256 header', async () => {
      mockDb.select = jest.fn().mockReturnValue(
        mockSelectChain([{ id: userId, email }]),
      );

      const { accessToken } = await service.loginWithOtp(userId, phone);
      const [headerB64] = accessToken.split('.');
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
    });
  });
});
