import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { PayoutProviderFactory } from '@/modules/remittance/providers/provider-factory.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly providerFactory: PayoutProviderFactory,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Basic health check' })
  async check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - checks all dependencies' })
  async ready() {
    const checks: Record<string, { status: string; latency: number; message?: string }> = {};

    // Database check
    const dbStart = Date.now();
    try {
      await this.db.execute(sql`SELECT 1`);
      checks.database = { status: 'ok', latency: Date.now() - dbStart };
    } catch (error: any) {
      checks.database = { status: 'error', latency: Date.now() - dbStart, message: error?.message };
    }

    // Provider check
    const providerStart = Date.now();
    try {
      const providers = this.providerFactory.getAllProviders();
      checks.providers = {
        status: 'ok',
        latency: Date.now() - providerStart,
        message: `${providers.size} providers loaded`,
      };
    } catch (error: any) {
      checks.providers = {
        status: 'error',
        latency: Date.now() - providerStart,
        message: error?.message,
      };
    }

    const allHealthy = Object.values(checks).every(c => c.status === 'ok');

    return {
      status: allHealthy ? 'ready' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Application metrics' })
  metrics() {
    const memUsage = process.memoryUsage();
    return {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
      },
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
      pid: process.pid,
      version: process.version,
    };
  }
}
