import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';

import { ProfilesService } from './profiles.service';

type ProfileRow = {
  id: string;
  settings: Record<string, unknown> | null;
};

function buildDbStub(initialRow: ProfileRow) {
  let row: ProfileRow = { ...initialRow };
  const setSpy = jest.fn();

  const db = {
    query: {
      profiles: {
        findFirst: jest.fn(async () => row),
      },
    },
    update: jest.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        setSpy(patch);
        if (patch.settings !== undefined) {
          row = { ...row, settings: patch.settings as Record<string, unknown> };
        }
        return {
          where: () => ({
            returning: async () => [row],
          }),
        };
      },
    })),
  };

  return { db, setSpy, getRow: () => row };
}

describe('ProfilesService — themeMode round-trip (sprint 02)', () => {
  async function buildService(stubDb: ReturnType<typeof buildDbStub>['db']) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        { provide: DRIZZLE, useValue: stubDb },
      ],
    }).compile();
    return module.get(ProfilesService);
  }

  it('persists themeMode=dark while preserving other settings keys', async () => {
    const stub = buildDbStub({
      id: 'u1',
      settings: {
        themeMode: 'system',
        operationalNotifications: true,
        marketingConsent: false,
        smsParserEnabled: false,
      },
    });
    const svc = await buildService(stub.db);

    const updated = await svc.updateMe('u1', { themeMode: 'dark' });

    expect(stub.setSpy).toHaveBeenCalledTimes(1);
    const patch = stub.setSpy.mock.calls[0][0];
    expect(patch.settings).toEqual({
      themeMode: 'dark',
      operationalNotifications: true,
      marketingConsent: false,
      smsParserEnabled: false,
    });
    expect((updated.settings as Record<string, unknown>).themeMode).toBe('dark');
  });

  it('accepts each valid themeMode value', async () => {
    for (const mode of ['system', 'light', 'dark'] as const) {
      const stub = buildDbStub({ id: 'u1', settings: {} });
      const svc = await buildService(stub.db);
      await svc.updateMe('u1', { themeMode: mode });
      const patch = stub.setSpy.mock.calls[0][0];
      expect((patch.settings as Record<string, unknown>).themeMode).toBe(mode);
    }
  });

  it('does not touch settings when themeMode is omitted', async () => {
    const stub = buildDbStub({
      id: 'u1',
      settings: { themeMode: 'light' },
    });
    const svc = await buildService(stub.db);
    await svc.updateMe('u1', { displayName: 'Riz' });
    const patch = stub.setSpy.mock.calls[0][0];
    expect(patch.settings).toBeUndefined();
  });
});
