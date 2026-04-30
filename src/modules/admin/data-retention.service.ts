import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, lte, sql, asc } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  dataRetentionPolicies,
  auditLogs,
  notifications,
  piiAccessLogs,
  type DataRetentionPolicy,
  type NewDataRetentionPolicy,
} from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** List all retention policies. */
  async listPolicies(): Promise<DataRetentionPolicy[]> {
    return this.db.select().from(dataRetentionPolicies).orderBy(asc(dataRetentionPolicies.resourceType));
  }

  /** Create a retention policy. */
  async createPolicy(adminId: string, dto: NewDataRetentionPolicy): Promise<DataRetentionPolicy> {
    const inserted = await this.db
      .insert(dataRetentionPolicies)
      .values({
        name: dto.name,
        resourceType: dto.resourceType,
        retentionDays: dto.retentionDays,
        autoDelete: dto.autoDelete ?? false,
        isActive: dto.isActive ?? true,
        nextRunAt: dto.nextRunAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdBy: adminId,
      })
      .returning();

    const policy = inserted[0];

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'create',
      resourceType: 'data_retention_policy',
      resourceId: policy.id,
      after: policy as unknown as Record<string, unknown>,
    });

    return policy;
  }

  /** Update a retention policy. */
  async updatePolicy(adminId: string, id: string, dto: Partial<NewDataRetentionPolicy>): Promise<DataRetentionPolicy> {
    const existing = await this.db.query.dataRetentionPolicies.findFirst({
      where: eq(dataRetentionPolicies.id, id),
    });
    if (!existing) throw new NotFoundException('Policy not found');

    const updated = await this.db
      .update(dataRetentionPolicies)
      .set({
        ...(dto.name && { name: dto.name }),
        ...(dto.retentionDays !== undefined && { retentionDays: dto.retentionDays }),
        ...(dto.autoDelete !== undefined && { autoDelete: dto.autoDelete }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.nextRunAt !== undefined && { nextRunAt: dto.nextRunAt }),
        updatedAt: new Date(),
      })
      .where(eq(dataRetentionPolicies.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'update',
      resourceType: 'data_retention_policy',
      resourceId: id,
      before: existing as unknown as Record<string, unknown>,
      after: updated[0] as unknown as Record<string, unknown>,
    });

    return updated[0];
  }

  /** Delete a retention policy. */
  async deletePolicy(adminId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.db.query.dataRetentionPolicies.findFirst({
      where: eq(dataRetentionPolicies.id, id),
    });
    if (!existing) throw new NotFoundException('Policy not found');

    await this.db.delete(dataRetentionPolicies).where(eq(dataRetentionPolicies.id, id));

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'delete',
      resourceType: 'data_retention_policy',
      resourceId: id,
    });

    return { ok: true };
  }

  /** Get upcoming deletions based on retention policies. */
  async getUpcomingDeletions(): Promise<Array<{ policy: DataRetentionPolicy; estimatedRecords: number; cutoffDate: Date }>> {
    const policies = await this.listPolicies();
    const now = new Date();
    const results: Array<{ policy: DataRetentionPolicy; estimatedRecords: number; cutoffDate: Date }> = [];

    for (const policy of policies) {
      if (!policy.isActive) continue;

      const cutoffDate = new Date(now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000);

      let count = 0;
      switch (policy.resourceType) {
        case 'audit_logs':
          count = await this.getTableCount('audit_logs', cutoffDate);
          break;
        case 'notifications':
          count = await this.getTableCount('notifications', cutoffDate);
          break;
        case 'pii_access_logs':
          count = await this.getTableCount('pii_access_logs', cutoffDate);
          break;
        default:
          break;
      }

      results.push({ policy, estimatedRecords: count, cutoffDate });
    }

    return results;
  }

  /** Auto-enforce retention policies — triggered by cron job or admin endpoint. */
  async enforceRetentionPolicies(): Promise<{ deleted: number; details: Array<{ resourceType: string; count: number }> }> {
    this.logger.log('Running retention policy enforcement...');

    const policies = await this.listPolicies();
    const now = new Date();
    let totalDeleted = 0;
    const details: Array<{ resourceType: string; count: number }> = [];

    for (const policy of policies) {
      if (!policy.isActive || !policy.autoDelete) continue;

      const cutoffDate = new Date(now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000);

      try {
        let deleted = 0;
        switch (policy.resourceType) {
          case 'audit_logs':
            deleted = await this.deleteFromTable('audit_logs', cutoffDate);
            break;
          case 'notifications':
            deleted = await this.deleteFromTable('notifications', cutoffDate);
            break;
          case 'pii_access_logs':
            deleted = await this.deleteFromTable('pii_access_logs', cutoffDate);
            break;
          default:
            this.logger.warn(`Unknown resource type: ${policy.resourceType}`);
        }

        await this.db
          .update(dataRetentionPolicies)
          .set({ lastRunAt: now, nextRunAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) })
          .where(eq(dataRetentionPolicies.id, policy.id));

        totalDeleted += deleted;
        details.push({ resourceType: policy.resourceType, count: deleted });
        this.logger.log(`Deleted ${deleted} records from ${policy.resourceType}`);
      } catch (err) {
        this.logger.error(`Failed to enforce policy ${policy.id}: ${err}`);
      }
    }

    this.logger.log('Retention policy enforcement complete');
    return { deleted: totalDeleted, details };
  }

  private async getTableCount(tableName: string, cutoff: Date): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT COUNT(*) as count FROM ${sql.raw(tableName)} WHERE created_at < ${cutoff}`,
    );
    return Number((result.rows?.[0] as Record<string, unknown>)?.count ?? 0);
  }

  private async deleteFromTable(tableName: string, cutoff: Date): Promise<number> {
    const result = await this.db.execute(
      sql`DELETE FROM ${sql.raw(tableName