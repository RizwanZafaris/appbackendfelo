import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: DRIZZLE,
          useValue: {
            execute: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('reports status ok with database connectivity', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('ok');
    expect(typeof result.uptimeSeconds).toBe('number');
  });

  it('reports database error when query fails', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: DRIZZLE,
          useValue: {
            execute: jest.fn().mockRejectedValue(new Error('boom')),
          },
        },
      ],
    }).compile();

    const failing = module.get(HealthController);
    const result = await failing.check();
    expect(result.status).toBe('ok');
    expect(result.database).toContain('error: boom');
  });
});
