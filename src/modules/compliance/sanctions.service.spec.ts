import { ConfigService } from '@nestjs/config';

import { DatabaseService } from '@/common/database.service';

import { SanctionsService } from './sanctions.service';

/**
 * Pure-logic tests for the stub provider. Database interaction is mocked
 * — the goal here is to lock in the deny-default behaviour and the
 * production safety check.
 */
describe('SanctionsService', () => {
  const fakeDb = (): DatabaseService =>
    ({
      db: {
        insert: () => ({ values: async () => undefined }),
      },
    } as unknown as DatabaseService);

  const cfg = (vars: Record<string, string>) =>
    ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

  it('returns clear for a benign request', async () => {
    const svc = new SanctionsService(cfg({ NODE_ENV: 'test', SANCTIONS_PROVIDER: 'stub' }), fakeDb());
    const r = await svc.screen({ userUuid: 'u', recipientHash: 'sha256:safe', recipientCountry: 'PK' });
    expect(r.outcome).toBe('clear');
  });

  it('blocks high-risk recipient country', async () => {
    const svc = new SanctionsService(cfg({ NODE_ENV: 'test', SANCTIONS_PROVIDER: 'stub' }), fakeDb());
    const r = await svc.screen({ userUuid: 'u', recipientHash: 'sha256:safe', recipientCountry: 'IR' });
    expect(r.outcome).toBe('block');
  });

  it('blocks specific sanctioned recipient hash', async () => {
    const svc = new SanctionsService(cfg({ NODE_ENV: 'test', SANCTIONS_PROVIDER: 'stub' }), fakeDb());
    const r = await svc.screen({
      userUuid: 'u',
      recipientHash: 'sha256:test-block-recipient',
      recipientCountry: 'PK',
    });
    expect(r.outcome).toBe('block');
  });

  it('refuses to construct in production with stub provider', () => {
    expect(
      () =>
        new SanctionsService(
          cfg({ NODE_ENV: 'production', SANCTIONS_PROVIDER: 'stub' }),
          fakeDb(),
        ),
    ).toThrow(/stub.*not permitted in production/);
  });

  it('returns error (deny) when provider throws', async () => {
    const svc = new SanctionsService(cfg({ NODE_ENV: 'test', SANCTIONS_PROVIDER: 'unknown' }), fakeDb());
    const r = await svc.screen({ userUuid: 'u', recipientHash: 'sha256:x' });
    expect(r.outcome).toBe('error');
  });
});
