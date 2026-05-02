import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';

export interface AuditLogEntry {
  id?: string;
  timestamp: Date;
  actorId: string;
  actorType: 'user' | 'admin' | 'system' | 'webhook';
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure' | 'denied';
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  private buffer: AuditLogEntry[] = [];
  private readonly bufferSize = 100;
  private flushIntervalMs = 5000;

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {
    // Periodic flush
    setInterval(() => this.flush(), this.flushIntervalMs);
  }

  async log(entry: AuditLogEntry): Promise<void> {
    // Redact sensitive fields before logging
    const sanitized = this.sanitize(entry);
    
    this.buffer.push(sanitized);
    
    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  async logAdminAction(
    adminId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, unknown>,
    status: 'success' | 'failure' | 'denied' = 'success',
  ): Promise<void> {
    await this.log({
      timestamp: new Date(),
      actorId: adminId,
      actorType: 'admin',
      action,
      resourceType,
      resourceId,
      details,
      status,
    });
  }

  async logUserAction(
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      timestamp: new Date(),
      actorId: userId,
      actorType: 'user',
      action,
      resourceType,
      resourceId,
      details,
      ipAddress,
      userAgent,
      status: 'success',
    });
  }

  async queryLogs(filters: {
    actorId?: string;
    actorType?: string;
    action?: string;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLogEntry[]; total: number }> {
    // In production, this queries from the audit_logs table
    // For now, return from buffer + any previously flushed logs
    return {
      logs: [],
      total: 0,
    };
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      // In production, insert into audit_logs table
      this.logger.log(`Flushing ${batch.length} audit log entries`);
      // await this.db.insert(auditLogs).values(batch);
    } catch (error) {
      this.logger.error('Failed to flush audit logs', error);
      // Re-add to buffer for retry
      this.buffer.unshift(...batch);
    }
  }

  private sanitize(entry: AuditLogEntry): AuditLogEntry {
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'creditCard', 'ssn'];
    const sanitized = { ...entry };
    
    if (sanitized.details) {
      sanitized.details = Object.entries(sanitized.details).reduce(
        (acc, [key, value]) => {
          if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
            acc[key] = '[REDACTED]';
          } else {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, unknown>,
      );
    }

    return sanitized;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }
}
