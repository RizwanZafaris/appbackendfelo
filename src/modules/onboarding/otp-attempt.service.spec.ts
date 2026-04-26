import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';

import { OtpAttemptService } from './otp-attempt.service';

/**
 * Audit §2 / §13 — OTP rate-limit edge cases:
 *   - 1st failure → counter=1, no cooldown
 *   - 3rd failure → counter=3, 30-min cooldown set
 *   - Within cooldown window → checkState reports inCooldown=true
 *   - Success → state wiped
 *   - Identity normalization (email lowercase, phone E.164 with +)
 */
describe('OtpAttemptService', () => {
  let service: OtpAttemptService;
  let store: Map<string, { fail_count: number; cooldown_until: Date | null }>;

  beforeEach(async () => {
    store = new Map();

    const executeMock = jest.fn().mockImplementation((tpl) => {
      // Parse the sql template to figure out (a) what statement, (b)
      // what identity/channel were interpolated.
      const chunks = tpl?.queryChunks ?? [];
      const sqlText = chunks
        .map((c: unknown) => {
          if (c && typeof c === 'object' && 'value' in (c as Record<string, unknown>)) {
            const v = (c as { value: unknown }).value;
            return Array.isArray(v) ? v.join(' ') : String(v);
          }
          return '';
        })
        .join(' ');
      const params = chunks.filter((c: unknown) => typeof c === 'string') as string[];
      const identity = params[0] ?? '';

      if (sqlText.includes('SELECT')) {
        const row = store.get(identity);
        return Promise.resolve(row ? [row] : []);
      }
      if (sqlText.includes('DELETE')) {
        store.delete(identity);
        return Promise.resolve([]);
      }
      if (sqlText.includes('INSERT')) {
        const existing = store.get(identity);
        const fail = (existing?.fail_count ?? 0) + 1;
        // Mirror the QA Bug 3 fix logic: preserve existing cooldown
        // if it's still in the future, otherwise set a new one when
        // crossing the threshold for the first time.
        const now = Date.now();
        let cd: Date | null;
        if (existing?.cooldown_until && existing.cooldown_until.getTime() > now) {
          cd = existing.cooldown_until;
        } else if (fail >= 3) {
          cd = new Date(now + 30 * 60 * 1000);
        } else {
          cd = null;
        }
        const row = { fail_count: fail, cooldown_until: cd };
        store.set(identity, row);
        return Promise.resolve([row]);
      }
      return Promise.resolve([]);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [OtpAttemptService, { provide: DRIZZLE, useValue: { execute: executeMock } }],
    }).compile();

    service = module.get(OtpAttemptService);
  });

  it('starts with no cooldown and 3 attempts remaining', async () => {
    const s = await service.checkState('+923001234567', 'sms');
    expect(s.inCooldown).toBe(false);
    expect(s.attemptsRemaining).toBe(3);
  });

  it('records 1st failure → counter=1, no cooldown', async () => {
    const s = await service.recordFailure('+923001234567', 'sms');
    expect(s.failCount).toBe(1);
    expect(s.inCooldown).toBe(false);
    expect(s.attemptsRemaining).toBe(2);
  });

  it('records 3rd failure → triggers 30-min cooldown', async () => {
    await service.recordFailure('+923001234567', 'sms');
    await service.recordFailure('+923001234567', 'sms');
    const s = await service.recordFailure('+923001234567', 'sms');
    expect(s.failCount).toBe(3);
    expect(s.inCooldown).toBe(true);
    expect(s.attemptsRemaining).toBe(0);
    expect(s.cooldownUntil).toBeInstanceOf(Date);
    const ms = s.cooldownUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(29 * 60 * 1000);
    expect(ms).toBeLessThan(31 * 60 * 1000);
  });

  it('checkState reports inCooldown=true within window', async () => {
    await service.recordFailure('+923001234567', 'sms');
    await service.recordFailure('+923001234567', 'sms');
    await service.recordFailure('+923001234567', 'sms');
    const s = await service.checkState('+923001234567', 'sms');
    expect(s.inCooldown).toBe(true);
  });

  it('recordSuccess wipes state', async () => {
    await service.recordFailure('+923001234567', 'sms');
    await service.recordSuccess('+923001234567', 'sms');
    const s = await service.checkState('+923001234567', 'sms');
    expect(s.failCount).toBe(0);
    expect(s.inCooldown).toBe(false);
  });

  it('normalizes email identity to lowercase', async () => {
    await service.recordFailure('Foo@Bar.com', 'email');
    const s = await service.checkState('foo@bar.com', 'email');
    expect(s.failCount).toBe(1);
  });

  it('normalizes phone identity to E.164 with leading +', async () => {
    await service.recordFailure('923001234567', 'sms');
    const s = await service.checkState('+92 300-1234567', 'sms');
    expect(s.failCount).toBe(1);
  });

  // QA Bug 3 — once cooldown is set, additional failures must not
  // refresh the timer. Otherwise a user who keeps trying during
  // lockout extends it indefinitely.
  it('does NOT refresh cooldown on attempts during active lockout (QA Bug 3)', async () => {
    await service.recordFailure('+923001234567', 'sms');
    await service.recordFailure('+923001234567', 'sms');
    const s3 = await service.recordFailure('+923001234567', 'sms');
    const initialCooldown = s3.cooldownUntil!.getTime();

    // Simulate user trying again during cooldown
    await new Promise((r) => setTimeout(r, 50));
    const s4 = await service.recordFailure('+923001234567', 'sms');
    expect(s4.cooldownUntil!.getTime()).toBe(initialCooldown);
  });
});
