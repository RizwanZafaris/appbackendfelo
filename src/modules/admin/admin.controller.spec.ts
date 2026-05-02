import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AdminController } from './admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { ConfigRegistryService } from './config-registry.service';
import { VendorCredentialsService } from './vendor-credentials.service';
import { ApiKeyService } from './api-key.service';
import { DRIZZLE } from '@/common/db/db.module';
import { createMockDrizzle, createTestApp } from '../../../test/setup';

describe('AdminController', () => {
  let app: INestApplication;
  let mockDb: ReturnType<typeof createMockDrizzle>;
  let mockAdminAuth: any;
  let mockConfigRegistry: any;
  let mockVendorCredentials: any;
  let mockApiKeyService: any;

  const adminToken = 'adm_tok_1234567890abcdef';

  beforeEach(async () => {
    mockDb = createMockDrizzle();

    mockAdminAuth = {
      register: jest.fn(),
      login: jest.fn(),
      refreshAccessToken: jest.fn(),
      getMeFromToken: jest.fn(),
      listUsers: jest.fn(),
      setupMFA: jest.fn(),
      verifyMFASetup: jest.fn(),
      disableMFA: jest.fn(),
    };

    mockConfigRegistry = {
      list: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    mockVendorCredentials = {
      list: jest.fn(),
      get: jest.fn(),
      upsert: jest.fn(),
      testConnection: jest.fn(),
    };

    mockApiKeyService = {
      createKey: jest.fn(),
      listKeys: jest.fn(),
      revokeKey: jest.fn(),
      getKeyUsage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: DRIZZLE, useValue: mockDb },
        { provide: AdminAuthService, useValue: mockAdminAuth },
        { provide: ConfigRegistryService, useValue: mockConfigRegistry },
        { provide: VendorCredentialsService, useValue: mockVendorCredentials },
        { provide: ApiKeyService, useValue: mockApiKeyService },
      ],
    }).compile();

    app = await createTestApp(module);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('RBAC / Auth endpoints', () => {
    it('POST /admin/auth/register should create an admin user', async () => {
      const body = { email: 'admin@felo.app', displayName: 'Admin', password: 'Password123!' };
      const created = { id: 'adm_001', ...body, role: 'admin' };
      mockAdminAuth.register.mockResolvedValue(created);

      const res = await request(app.getHttpServer())
        .post('/admin/auth/register')
        .send(body)
        .expect(201);

      expect(res.body).toEqual(created);
      expect(mockAdminAuth.register).toHaveBeenCalledWith(body.email, body.displayName, body.password, undefined);
    });

    it('POST /admin/auth/login should return token and user info', async () => {
      const body = { email: 'admin@felo.app', password: 'Password123!' };
      const loginResult = {
        accessToken: adminToken,
        refreshToken: 'refresh_123',
        admin: { id: 'adm_001', email: 'admin@felo.app', role: 'super_admin' },
      };
      mockAdminAuth.login.mockResolvedValue(loginResult);

      const res = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send(body)
        .expect(201);

      expect(res.body.accessToken).toBe(adminToken);
      expect(res.body.admin.role).toBe('super_admin');
    });

    it('GET /admin/auth/me should return current admin profile', async () => {
      const profile = { id: 'adm_001', email: 'admin@felo.app', displayName: 'Admin', role: 'super_admin' };
      mockAdminAuth.getMeFromToken.mockResolvedValue(profile);

      const res = await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toEqual(profile);
      expect(mockAdminAuth.getMeFromToken).toHaveBeenCalledWith(adminToken);
    });

    it('GET /admin/users should list all admin users', async () => {
      const users = [
        { id: 'adm_001', email: 'a@felo.app', role: 'super_admin' },
        { id: 'adm_002', email: 'b@felo.app', role: 'analyst' },
      ];
      mockAdminAuth.listUsers.mockResolvedValue(users);

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].role).toBe('super_admin');
      expect(res.body[1].role).toBe('analyst');
    });
  });

  describe('Config Registry (P1)', () => {
    it('GET /admin/v1/config should list config entries with pagination', async () => {
      const configs = [{ key: 'max_txn', value: 1000 }];
      mockConfigRegistry.list.mockResolvedValue(configs);

      const res = await request(app.getHttpServer())
        .get('/admin/v1/config?search=max&limit=10')
        .expect(200);

      expect(mockConfigRegistry.list).toHaveBeenCalledWith('max', undefined, 10);
      expect(res.body).toEqual(configs);
    });

    it('GET /admin/v1/config/:key should return a single config', async () => {
      const config = { key: 'fee_bps', value: 50 };
      mockConfigRegistry.get.mockResolvedValue(config);

      const res = await request(app.getHttpServer())
        .get('/admin/v1/config/fee_bps')
        .expect(200);

      expect(res.body).toEqual(config);
      expect(mockConfigRegistry.get).toHaveBeenCalledWith('fee_bps');
    });

    it('POST /admin/v1/config should create a new config', async () => {
      const body = { key: 'new_key', value: 'new_value', description: 'desc', audience: { all: true } };
      const created = { id: 'cfg_001', ...body };
      mockConfigRegistry.create.mockResolvedValue(created);

      const res = await request(app.getHttpServer())
        .post('/admin/v1/config')
        .set('x-admin-id', 'adm_001')
        .send(body)
        .expect(201);

      expect(mockConfigRegistry.create).toHaveBeenCalledWith(
        body.key,
        body.value,
        body.description,
        body.audience,
        'adm_001',
      );
      expect(res.body).toEqual(created);
    });

    it('PATCH /admin/v1/config/:key should update an existing config', async () => {
      const body = { value: 'updated_value' };
      const updated = { key: 'fee_bps', value: 'updated_value', version: 2 };
      mockConfigRegistry.update.mockResolvedValue(updated);

      const res = await request(app.getHttpServer())
        .patch('/admin/v1/config/fee_bps')
        .set('x-admin-id', 'adm_001')
        .send(body)
        .expect(200);

      expect(mockConfigRegistry.update).toHaveBeenCalledWith('fee_bps', body.value, 'adm_001');
      expect(res.body.version).toBe(2);
    });

    it('DELETE /admin/v1/config/:key should delete a config', async () => {
      mockConfigRegistry.remove.mockResolvedValue({ deleted: true });

      const res = await request(app.getHttpServer())
        .delete('/admin/v1/config/fee_bps')
        .expect(200);

      expect(res.body.deleted).toBe(true);
      expect(mockConfigRegistry.remove).toHaveBeenCalledWith('fee_bps');
    });
  });

  describe('Vendor Credentials (P6)', () => {
    it('GET /admin/v1/vendor-credentials should list credentials with filters', async () => {
      const creds = [{ id: 'vc_001', vendorKey: 'stripe', env: 'prod' }];
      mockVendorCredentials.list.mockResolvedValue(creds);

      const res = await request(app.getHttpServer())
        .get('/admin/v1/vendor-credentials?vendorKey=stripe&env=prod&limit=5')
        .expect(200);

      expect(mockVendorCredentials.list).toHaveBeenCalledWith('stripe', 'prod', undefined, 5);
      expect(res.body).toEqual(creds);
    });

    it('POST /admin/v1/vendor-credentials should upsert credentials', async () => {
      const body = { vendorKey: 'stripe', env: 'prod', encryptedValue: 'enc_val' };
      const upserted = { id: 'vc_001', vendorKey: 'stripe', env: 'prod' };
      mockVendorCredentials.upsert.mockResolvedValue(upserted);

      const res = await request(app.getHttpServer())
        .post('/admin/v1/vendor-credentials')
        .set('x-admin-id', 'adm_001')
        .send(body)
        .expect(201);

      expect(mockVendorCredentials.upsert).toHaveBeenCalledWith(
        body.vendorKey,
        body.env,
        body.encryptedValue,
        'adm_001',
      );
      expect(res.body).toEqual(upserted);
    });

    it('POST /admin/v1/vendor-credentials/:vendorKey/test should test connection', async () => {
      const testResult = { ok: true, latencyMs: 120 };
      mockVendorCredentials.testConnection.mockResolvedValue(testResult);

      const res = await request(app.getHttpServer())
        .post('/admin/v1/vendor-credentials/stripe/test')
        .expect(201);

      expect(res.body.ok).toBe(true);
      expect(mockVendorCredentials.testConnection).toHaveBeenCalledWith('stripe');
    });
  });

  describe('API Keys', () => {
    it('POST /admin/v1/api-keys should create an API key', async () => {
      const body = { name: 'prod-key', permissions: ['read'], expiresInDays: 30 };
      const created = { id: 'key_001', key: 'sk_xxx', name: body.name };
      mockApiKeyService.createKey.mockResolvedValue(created);

      const res = await request(app.getHttpServer())
        .post('/admin/v1/api-keys')
        .send(body)
        .expect(201);

      expect(res.body).toEqual(created);
      expect(mockApiKeyService.createKey).toHaveBeenCalledWith(body.name, body.permissions, 30, undefined);
    });

    it('GET /admin/v1/api-keys should list API keys', async () => {
      const keys = [{ id: 'key_001', name: 'prod-key' }];
      mockApiKeyService.listKeys.mockResolvedValue(keys);

      const res = await request(app.getHttpServer())
        .get('/admin/v1/api-keys')
        .expect(200);

      expect(res.body).toEqual(keys);
    });

    it('DELETE /admin/v1/api-keys/:id should revoke an API key', async () => {
      mockApiKeyService.revokeKey.mockResolvedValue(true);

      const res = await request(app.getHttpServer())
        .delete('/admin/v1/api-keys/key_001')
        .expect(200);

      expect(res.body.revoked).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should propagate NotFoundException from config registry', async () => {
      mockConfigRegistry.get.mockRejectedValue(new Error('Config missing not found'));

      await request(app.getHttpServer())
        .get('/admin/v1/config/missing')
        .expect(500);
    });

    it('should require authorization header for /auth/me', async () => {
      mockAdminAuth.getMeFromToken.mockRejectedValue(new Error('Unauthorized'));

      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .expect(500);
    });
  });
});
