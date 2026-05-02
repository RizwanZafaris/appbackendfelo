import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

import { DatabaseService } from '@/common/database.service';

import { RemittanceWebhookGuard } from './remittance-webhook.guard';

/**
 * Webhook guard unit tests — locks in HMAC verification, replay window,
 * and the duplicate-event behaviour. The DB layer is mocked.
 */
describe('RemittanceWebhookGuard', () => {
  const SECRET = 'unit-test-secret-32-bytes-long-aaaaaaaa';

  const cfg = (vars: Record<string, string>): ConfigService =>
    ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

  const fakeDb = (insertImpl: () => Promise<unknown>): DatabaseService =>
    ({
      db: {
        insert: () => ({ values: insertImpl }),
      },
    } as unknown as DatabaseService);

  const ctx = (req: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;

  const sign = (body: Buffer): string => createHmac('sha256', SECRET).update(body).digest('hex');

  it('accepts a request with valid signature, fresh timestamp, unique event-id', async () => {
    const body = Buffer.from(JSON.stringify({ ok: true }));
    const guard = new RemittanceWebhookGuard(
      cfg({ WEBHOOK_SECRET_8B: SECRET }),
      fakeDb(async () => undefined),
    );
    const req = {
      params: { providerCode: '8b' },
      headers: {
        'x-signature': sign(body),
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-event-id': 'evt-1',
      },
      rawBody: body,
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('rejects mismatched signature', async () => {
    const body = Buffer.from('{}');
    const guard = new RemittanceWebhookGuard(
      cfg({ WEBHOOK_SECRET_8B: SECRET }),
      fakeDb(async () => undefined),
    );
    const req = {
      params: { providerCode: '8b' },
      headers: {
        'x-signature': 'deadbeef',
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-event-id': 'evt-2',
      },
      rawBody: body,
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects expired timestamp', async () => {
    const body = Buffer.from('{}');
    const guard = new RemittanceWebhookGuard(
      cfg({ WEBHOOK_SECRET_8B: SECRET }),
      fakeDb(async () => undefined),
    );
    const req = {
      params: { providerCode: '8b' },
      headers: {
        'x-signature': sign(body),
        'x-timestamp': String(Math.floor((Date.now() - 60 * 60 * 1000) / 1000)),
        'x-event-id': 'evt-3',
      },
      rawBody: body,
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/tolerance window/);
  });

  it('rejects empty raw body (catches misconfigured parser)', async () => {
    const guard = new RemittanceWebhookGuard(
      cfg({ WEBHOOK_SECRET_8B: SECRET }),
      fakeDb(async () => undefined),
    );
    const req = {
      params: { providerCode: '8b' },
      headers: {
        'x-signature': 'abc',
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-event-id': 'evt-4',
      },
      rawBody: undefined,
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Empty raw body/);
  });

  it('rejects when provider has no configured secret', async () => {
    const body = Buffer.from('{}');
    const guard = new RemittanceWebhookGuard(cfg({}), fakeDb(async () => undefined));
    const req = {
      params: { providerCode: 'unknown' },
      headers: {
        'x-signature': 'abc',
        'x-event-id': 'evt-5',
      },
      rawBody: body,
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/secret not configured/);
  });

  it('rejects duplicate event_id (replay)', async () => {
    const body = Buffer.from('{}');
    const dupErr = Object.assign(new Error('dup'), { code: '23505' });
    const guard = new RemittanceWebhookGuard(
      cfg({ WEBHOOK_SECRET_8B: SECRET }),
      fakeDb(async () => {
        throw dupErr;
      }),
    );
    const req = {
      params: { providerCode: '8b' },
      headers: {
        'x-signature': sign(body),
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-event-id': 'evt-replay',
      },
      rawBody: body,
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/already processed/);
  });
});
