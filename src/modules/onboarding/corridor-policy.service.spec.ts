import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';

import { CorridorPolicyService } from './corridor-policy.service';

/**
 * Audit §13 — corridor policy edge cases:
 *   - PK→IN blocked
 *   - PK→IL blocked
 *   - PK→KP sanctioned (region-status fallback)
 *   - PK→CA allowed
 *   - Sanctioned region anywhere blocks
 *   - allowedSecondaries filters bulk
 *
 * Mock strategy: drizzle's `db.execute` is called once per query in
 * service code; we hand back a sequence of pre-baked rowsets.
 */
describe('CorridorPolicyService', () => {
  let service: CorridorPolicyService;

  // Pre-canned rowsets used by execute() in call-order.
  const corridorRows = [
    { from_iso2: 'PK', to_iso2: 'IN', status: 'blocked', reason: 'Bilateral' },
    { from_iso2: 'PK', to_iso2: 'IL', status: 'blocked', reason: 'Diplomatic' },
  ];
  const regionRows = [
    { iso2: 'PK', country_status: 'active' },
    { iso2: 'CA', country_status: 'active' },
    { iso2: 'IL', country_status: 'not_supported' },
    { iso2: 'IR', country_status: 'sanctioned' },
    { iso2: 'KP', country_status: 'sanctioned' },
    { iso2: 'GB', country_status: 'active' },
    { iso2: 'IN', country_status: 'active' },
  ];

  // Inspect the Drizzle sql template's queryChunks to figure out which
  // table is being queried — this avoids ordering races under
  // parallel Promise.all loads.
  beforeEach(async () => {
    const executeMock = jest.fn().mockImplementation((tpl) => {
      const sqlText = (tpl?.queryChunks ?? [])
        .map((c: unknown) => {
          if (c && typeof c === 'object' && 'value' in (c as Record<string, unknown>)) {
            const v = (c as { value: unknown }).value;
            return Array.isArray(v) ? v.join(' ') : String(v);
          }
          return '';
        })
        .join(' ');
      if (sqlText.includes('country_corridors')) {
        return Promise.resolve(corridorRows);
      }
      if (sqlText.includes('regions')) {
        return Promise.resolve(regionRows);
      }
      return Promise.resolve([]);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [CorridorPolicyService, { provide: DRIZZLE, useValue: { execute: executeMock } }],
    }).compile();

    service = module.get(CorridorPolicyService);
  });

  it('blocks PK → IN (audit §4)', async () => {
    const d = await service.check('PK', 'IN');
    expect(d.allowed).toBe(false);
    expect(d.status).toBe('blocked');
  });

  it('blocks PK → IL (audit §4)', async () => {
    const d = await service.check('PK', 'IL');
    expect(d.allowed).toBe(false);
  });

  it('blocks PK → KP via region-level sanctioned status', async () => {
    const d = await service.check('PK', 'KP');
    expect(d.allowed).toBe(false);
    expect(d.status).toBe('sanctioned');
  });

  it('allows PK → CA (no rule, both active)', async () => {
    const d = await service.check('PK', 'CA');
    expect(d.allowed).toBe(true);
  });

  it('blocks ANY → sanctioned region via region status fallback', async () => {
    const d = await service.check('CA', 'IR');
    expect(d.allowed).toBe(false);
    expect(d.status).toBe('sanctioned');
  });

  it('allowedSecondaries filters out blocked corridors', async () => {
    const allowed = await service.allowedSecondaries('PK', ['CA', 'IN', 'IL', 'GB']);
    expect(allowed).toContain('CA');
    expect(allowed).toContain('GB');
    expect(allowed).not.toContain('IN');
    expect(allowed).not.toContain('IL');
  });
});
