import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { Public } from '@/common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + DB connectivity probe' })
  async check() {
    let database = 'unknown';
    try {
      await this.db.execute(sql`SELECT 1`);
      database = 'ok';
    } catch (err) {
      database = `error: ${err instanceof Error ? err.message : 'unknown'}`;
    }

    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.0.0',
      database,
    };
  }
}
