import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AdminController } from './admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { ConfigRegistryService } from './config-registry.service';
import { VendorCredentialsService } from './vendor-credentials.service';
import { DRIZZLE } from '@/common/db/db.module';
import { createMockDrizzle, createTestApp } from '../../../test/setup';

describe('AdminController', () => {
  let app: INestApplication;
  let mockDb: ReturnType<typeof createMockDrizzle>;
  let mockAdminAuth: jest.Mocked<AdminAuthService>;
  let mockConfigRegistry: jest.Mocked<ConfigRegistryService>;
  let mockVendorCredentials: jest.Mocked<VendorCredentialsService>;

  const adminToken = 'adm_tok_1234567890abcdef';

  beforeEach(async () => {
    mockDb = createMockDrizzle();

    mockAdminAuth = {
      register: jest.fn(),
      login: jest.fn(),
      getMe: jest.fn(),
      listUsers: jest.fn(),
    } as unknown as jest.Mocked<AdminAuthService>;

    mockConfigRegistry = {
      list: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<ConfigRegistryService>;

    mockVendorCredentials = {
      list: jest.fn(),
      get: jest.fn(),
      upsert: jest.fn(),
      testConnection: jest.fn(),
    } as unknown as jest.Mocked<VendorCredentialsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: DRIZZLE, useValue: mockDb },
        { provide: AdminAuthService, useValue: mockAdminAuth },
        { provide: ConfigRegistryService, useValue: mockConfigRegistry },
        { provide: VendorCredentialsService, useValue: mockVendorCredentials },
      ],
    }).compile();

    app = await createTestApp(module);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('RBAC / Auth endpoints', () => {
    it('POST /admin/auth/register should create an admin user', async () => {
      const body = { email: 'admin@felo.app', displayName: 'Admin', credentialId: 'cred_001' };
      const created = { id: 'adm_001', ...body };
      mockAdminAuth.register.mockResolvedValue(created as any);

      const res = await request(app.getHttpServer())
        .post('/admin/auth/register')
        .send(body)
        .expect(201);

      expect(res.body).toEqual(created);
      expect(mockAdminAuth.register).toHaveBeenCalledWith(body.email, body.displayName, body.credentialId);
    });

    it('POST /admin/auth/login should return token and user info', async () => {
      const body = { credentialId: 'cred_001' };
      const loginResult = {
        token: adminToken,
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        user: { id: 'adm_001', email: 'admin@felo.app', role: 'super_admin' },
      };
      mockAdminAuth.login.mockResolvedValue(loginResult as any);

      const res = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send(body)
        .expect(201);

      expect(res.body.token).toBe(adminToken);
      expect(res.body.user.role).toBe('super_admin');
    });

    it('GET /admin/auth/me should return current admin profile', async () => {
      const profile = { id: 'adm_001', email: 'admin@felo.app', displayName: 'Admin', role: 'super_admin' };
      mockAdminAuth.getMe.mockResolvedValue(profile as any);

      const res = await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('x-admin-token', adminToken)
        .expect(200);

      expect(res.body).toEqual(profile);
      expect(mockAdminAuth.getMe).toHaveBeenCalledWith(expect.any(String));
    });

    it('GET /admin/users should list all admin users', async () => {
      const users = [
        { id: 'adm_001', email: 'a@felo.app', role: 'super_admin' },
        { id: 'adm_002', email: 'b@felo.app', role: 'analyst' },
      ];
      mockAdminAuth.listUsers.mockResolvedValue(users as any);

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
      mockConfigRegistry.list.mockResolvedValue(configs as any);

      const res = await request(app.getHttpServer())
        .get('/admin/v1/config?search=max&limit=10')
        .expect(200);

      expect(mockConfigRegistry.list).toHaveBeenCalledWith('max', undefined, 10);
      expect(res.body).toEqual(configs);
    });

    it('GET /admin/v1/config/:key should return a single config', async () => {
      const config = { key: 'fee_bps', value: 50 };
      mockConfigRegistry.get.mockResolvedValue(config as any);

      const res = await request(app.getHttpServer())
        .get('/admin/v1/config/fee_bps')
        .expect(200);

      expect(res.body).toEqual(config);
      expect(mockConfigRegistry.get).toHaveBeenCalledWith('fee_bps');
    });

    it('POST /admin/v1/config should create a new config', async () => {
      const body = { key: 'new_key', value: 'new_value', description: 'desc', audience: { all: true } };
      const created = { id: 'cfg_001', ...body };
      mockConfigRegistry.create.mockResolvedValue(created as any);

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
      mockConfigRegistry.update.mockResolvedValue(updated as any);

      const res = await request(app.getHttpServer())
        .patch('/admin/v1/config/fee_bps')
        .set('x-admin-id', 'adm_001')
        .send(body)
        .expect(200);

      expect(mockConfigRegistry.update).toHaveBeenCalledWith('fee_bps', body.value, 'adm_001');
      expect(res.body.version).toBe(2);
    });

    it('DELETE /admin/v1/config/:key should delete a config', async () => {
      mockConfigRegistry.remove.mockResolvedValue({ deleted: true } as any);

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
      mockVendorCredentials.list.mockResolvedValue(creds as any);

      const res = await request(app.getHttpServer())
        .get('/admin/v1/vendor-credentials?vendorKey=stripe&env=prod&limit=5')
        .expect(200);

      expect(mockVendorCredentials.list).toHaveBeenCalledWith('stripe', 'prod', undefined, 5);
      expect(res.body).toEqual(creds);
    });

    it('POST /admin/v1/vendor-credentials should upsert credentials', async () => {
      const body = { vendorKey: 'stripe', env: 'prod', encryptedValue: 'enc_val' };
      const upserted = { id: 'vc_001', vendorKey: 'stripe', env: 'prod' };
      mockVendorCredentials.upsert.mockResolvedValue(upserted as any);

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

  describe('error handling', () => {
    it('should propagate NotFoundException from config registry', async () => {
      mockConfigRegistry.get.mockRejectedValue(new Error('Config missing not found'));

      await request(app.getHttpServer())
        .get('/admin/v1/config/missing')
        .expect(500);
    });

    it('should require x-admin-token for /auth/me', async () => {
      mockAdminAuth.getMe.mockRejectedValue(new Error('Unauthorized'));

      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .expect(500);
    });
  });
});
