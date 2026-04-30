import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, like, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { i18nStrings, type I18nString, type NewI18nString } from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class I18nService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** Get all strings for a locale. */
  async getStrings(locale: string = 'en'): Promise<Record<string, string>> {
    const rows = await this.db.select().from(i18nStrings);

    const result: Record<string, string> = {};
    for (const row of rows) {
      const value = locale === 'ur' ? (row.valueUr ?? row.valueEn) : row.valueEn;
      result[row.key] = value;
    }

    return result;
  }

  /** Admin: List all i18n strings. */
  async list(query?: string): Promise<I18nString[]> {
    if (query) {
      return this.db
        .select()
        .from(i18nStrings)
        .where(like(i18nStrings.key, `%${query}%`))
        .orderBy(i18nStrings.key);
    }
    return this.db.select().from(i18nStrings).orderBy(i18nStrings.key);
  }

  /** Admin: Create a string. */
  async create(adminId: string, dto: NewI18nString): Promise<I18nString> {
    const existing = await this.db.query.i18nStrings.findFirst({
      where: eq(i18nStrings.key, dto.key),
    });
    if (existing) throw new NotFoundException('Key already exists');

    const inserted = await this.db
      .insert(i18nStrings)
      .values({
        key: dto.key,
        valueEn: dto.valueEn,
        valueUr: dto.valueUr ?? null,
        context: dto.context ?? null,
        version: 1,
      })
      .returning();

    const str = inserted[0];

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'create',
      resourceType: 'i18n_string',
      resourceId: str.id,
      after: str as unknown as Record<string, unknown>,
    });

    return str;
  }

  /** Admin: Update a string. */
  async update(adminId: string, id: string, dto: Partial<Pick<NewI18nString, 'valueEn' | 'valueUr' | 'context'>>): Promise<I18nString> {
    const existing = await this.db.query.i18nStrings.findFirst({
      where: eq(i18nStrings.id, id),
    });
    if (!existing) throw new NotFoundException('String not found');

    const updated = await this.db
      .update(i18nStrings)
      .set({
        ...(dto.valueEn !== undefined && { valueEn: dto.valueEn }),
        ...(dto.valueUr !== undefined && { valueUr: dto.valueUr }),
        ...(dto.context !== undefined && { context: dto.context }),
        version: sql`${i18nStrings.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(i18nStrings.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'update',
      resourceType: 'i18n_string',
      resourceId: id,
      before: existing as unknown as Record<string, unknown>,
      after: updated[0] as unknown as Record<string, unknown>,
    });

    return updated[0];
  }

  /** Admin: Delete a string. */
  async delete(adminId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.db.query.i18nStrings.findFirst({
      where: eq(i18nStrings.id, id),
    });
    if (!existing) throw new NotFoundException('String not found');

    await this.db.delete(i18nStrings).where(eq(i18nStrings.id, id));

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'delete',
      resourceType: 'i18n_string',
      resourceId: id,
    });

    return { ok: true };
  }
}
