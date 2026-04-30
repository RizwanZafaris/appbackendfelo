import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { appConfig } from '@db/schema';

@Injectable()
export class ConfigRegistryService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async list(search?: string, cursor?: string, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    const conditions = [] as ReturnType<typeof eq>[];
    if (search) conditions.push(ilike(appConfig.key, `%${search}%`));
    if (cursor) {
      conditions.push(sql`${appConfig.updatedAt} < ${new Date(cursor)}` as never);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const q = this.db.select().from(appConfig);
    return where
      ? q.where(where).orderBy(desc(appConfig.updatedAt)).limit(safeLimit)
      : q.orderBy(desc(appConfig.updatedAt)).limit(safeLimit);
  }

  async get(key: string) {
    const [row] = await this.db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1);
    if (!row) throw new NotFoundException(`Config ${key} not found`);
    return row;
  }

  async create(key: string, value: unknown, description?: string, audience?: unknown, adminId?: string) {
    const [row] = await this.db
      .insert(appConfig)
      .values({
        key,
        value: value as Record<string, unknown>,
        description,
        audience: (audience ?? {}) as Record<string, unknown>,
        version: 1,
        updatedByAdminId: adminId,
      })
      .returning();
    return row;
  }

  async update(key: string, value: unknown, adminId?: string) {
    const [existing] = await this.db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1);
    if (!existing) throw new NotFoundException(`Config ${key} not found`);
    const [row] = await this.db
      .update(appConfig)
      .set({
        value: value as Record<string, unknown>,
        version: existing.version + 1,
        updatedByAdminId: adminId,
        updatedAt: new Date(),
      })
      .where(eq(appConfig.key, key))
      .returning();
    return row;
  }

  async remove(key: string) {
    const result = await this.db.delete(appConfig).where(eq(appConfig.key, key)).returning();
    if (!result[0]) throw new NotFoundException(`Config ${key} not found`);
    return { deleted: true };
  }
}
