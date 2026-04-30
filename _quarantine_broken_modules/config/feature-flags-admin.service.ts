import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { featureFlags, type FeatureFlag, type NewFeatureFlag } from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class FeatureFlagsAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** List all feature flags. */
  async list(): Promise<FeatureFlag[]> {
    return this.db.select().from(featureFlags).orderBy(featureFlags.key);
  }

  /** Create a feature flag. */
  async create(adminId: string, dto: NewFeatureFlag): Promise<FeatureFlag> {
    const existing = await this.db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, dto.key),
    });
    if (existing) throw new BadRequestException('Flag key already exists');

    const inserted = await this.db
      .insert(featureFlags)
      .values({
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        enabled: dto.enabled ?? false,
        targeting: dto.targeting ?? {},
        killSwitch: false,
        createdBy: adminId,
      })
      .returning();

    const flag = inserted[0];

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'create',
      resourceType: 'feature_flag',
      resourceId: flag.id,
      after: flag as unknown as Record<string, unknown>,
    });

    return flag;
  }

  /** Update a feature flag. */
  async update(adminId: string, id: string, dto: Partial<NewFeatureFlag>): Promise<FeatureFlag> {
    const existing = await this.db.query.featureFlags.findFirst({
      where: eq(featureFlags.id, id),
    });
    if (!existing) throw new NotFoundException('Feature flag not found');

    const updated = await this.db
      .update(featureFlags)
      .set({
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.targeting && { targeting: dto.targeting }),
        updatedAt: new Date(),
      })
      .where(eq(featureFlags.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'update',
      resourceType: 'feature_flag',
      resourceId: id,
      before: existing as unknown as Record<string, unknown>,
      after: updated[0] as unknown as Record<string, unknown>,
    });

    return updated[0];
  }

  /** Kill switch — immediately disable a feature. */
  async killSwitch(adminId: string, id: string): Promise<FeatureFlag> {
    const existing = await this.db.query.featureFlags.findFirst({
      where: eq(featureFlags.id, id),
    });
    if (!existing) throw new NotFoundException('Feature flag not found');

    const updated = await this.db
      .update(featureFlags)
      .set({
        enabled: false,
        killSwitch: true,
        updatedAt: new Date(),
      })
      .where(eq(featureFlags.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'kill_switch',
      resourceType: 'feature_flag',
      resourceId: id,
      before: { enabled: existing.enabled },
      after: { enabled: false, killSwitch: true },
    });

    return updated[0];
  }

  /** Delete a feature flag. */
  async delete(adminId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.db.query.featureFlags.findFirst({
      where: eq(featureFlags.id, id),
    });
    if (!existing) throw new NotFoundException('Feature flag not found');

    await this.db.delete(featureFlags).where(eq(featureFlags.id, id));

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'delete',
      resourceType: 'feature_flag',
      resourceId: id,
    });

    return { ok: true };
  }

  /** Check if a feature is enabled for a user context. */
  async checkFlag(key: string, context: { corridor?: string; tier?: string }): Promise<boolean> {
    const flag = await this.db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, key),
    });
    if (!flag) return false;
    if (!flag.enabled) return false;
    if (flag.killSwitch) return false;

    const targeting = (flag.targeting ?? {}) as Record<string, string[]>;

    if (targeting.corridors?.length && context.corridor) {
      if (!targeting.corridors.includes(context.corridor)) return false;
    }
    if (targeting.tiers?.length && context.tier) {
      if (!targeting.tiers.includes(context.tier)) return false;
    }

    return true;
  }
}
