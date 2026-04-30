import { Injectable, Inject } from '@nestjs/common';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { auditLogs, NewAuditLog } from '@db/schema';

export interface AuditEntry {
  actorId: string;
  actorType: 'admin' | 'user' | 'system';
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Central audit logging service. Every mutation in the admin portal
 * should call audit.log() for compliance traceability.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: entry.actorId,
      actorType: entry.actorType,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: entry.metadata ?? {},
    });
  }
}
