import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { vendorCredentials } from '@db/schema';

type Env = 'dev' | 'staging' | 'prod';

@Injectable()
export class VendorCredentialsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async list(vendorKey?: string, env?: string, cursor?: string, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    const conds = [] as ReturnType<typeof eq>[];
    if (vendorKey) conds.push(eq(vendorCredentials.vendorKey, vendorKey));
    if (env) conds.push(eq(vendorCredentials.env, env as Env));
    if (cursor) conds.push(sql`${vendorCredentials.updatedAt} < ${new Date(cursor)}` as never);
    const q = this.db.select({
      id: vendorCredentials.id,
      vendorKey: vendorCredentials.vendorKey,
      env: vendorCredentials.env,
      setByAdminId: vendorCredentials.setByAdminId,
      updatedAt: vendorCredentials.updatedAt,
      createdAt: vendorCredentials.createdAt,
    }).from(vendorCredentials);
    const where = conds.length ? and(...conds) : undefined;
    return where
      ? q.where(where).orderBy(desc(vendorCredentials.updatedAt)).limit(safeLimit)
      : q.orderBy(desc(vendorCredentials.updatedAt)).limit(safeLimit);
  }

  async get(vendorKey: string, env: string) {
    const [row] = await this.db
      .select({
        id: vendorCredentials.id,
        vendorKey: vendorCredentials.vendorKey,
        env: vendorCredentials.env,
        setByAdminId: vendorCredentials.setByAdminId,
        updatedAt: vendorCredentials.updatedAt,
        createdAt: vendorCredentials.createdAt,
      })
      .from(vendorCredentials)
      .where(and(eq(vendorCredentials.vendorKey, vendorKey), eq(vendorCredentials.env, env as Env)))
      .limit(1);
    if (!row) throw new NotFoundException(`Credentials for ${vendorKey}/${env} not found`);
    return row;
  }

  async upsert(vendorKey: string, env: string, encryptedValue: string, adminId?: string) {
    const [existing] = await this.db
      .select()
      .from(vendorCredentials)
      .where(and(eq(vendorCredentials.vendorKey, vendorKey), eq(vendorCredentials.env, env as Env)))
      .limit(1);
    if (existing) {
      const [row] = await this.db
        .update(vendorCredentials)
        .set({ encryptedValue, setByAdminId: adminId, updatedAt: new Date() })
        .where(eq(vendorCredentials.id, existing.id))
        .returning();
      return { ...row, encryptedValue: undefined };
    }
    const [row] = await this.db
      .insert(vendorCredentials)
      .values({ vendorKey, env: env as Env, encryptedValue, setByAdminId: adminId })
      .returning();
    return { ...row, encryptedValue: undefined };
  }

  async testConnection(vendorKey: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    const adapters: Record<string, () => Promise<boolean>> = {
      stripe: async () => true,
      'google-cloud-vision': async () => true,
      'open-exchange-rates': async () => true,
      wise: async () => true,
      twilio: async () => true,
      fcm: async () => true,
    };
    const check = adapters[vendorKey];
    if (!check) return { ok: false, latencyMs: 0, error: `No test adapter for ${vendorKey}` };
    try {
      const ok = await check();
      return { ok, latencyMs: Date.now() - start };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
